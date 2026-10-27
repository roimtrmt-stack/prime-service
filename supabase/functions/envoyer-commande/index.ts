import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { orangeSmsEnabled, sendOrangeSms } from "../_shared/orange-sms.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STORAGE_ORIGIN = "https://kfxalpvbtbvkncztjwzc.supabase.co";
const MAX_BODY_BYTES = 300_000;
const MAX_PANIER_ITEMS = 30;
const MAX_IMAGE_BYTES = 8_000_000;
const MAX_TEXT = 2_000;
const ALLOWED_ORIGINS = new Set([
  "https://roimtrmt-stack.github.io",
  "https://primeservice.netlify.app",
  "http://localhost:4173",
  "http://localhost:5173",
]);
const SITE_ORIGIN = "https://roimtrmt-stack.github.io/prime-service";
const ORANGE_PAYMENT_NUMBER = (Deno.env.get("ORANGE_PAYMENT_NUMBER") || "94134408").replace(/\D/g, "").slice(-8);
// 🧾 Commission par paliers : 8 % du prix de base, arrondie au multiple de 100
// supérieur, minimum 300 FCFA. Exemples : base 2000 → 300, 5000 → 400, 10000 → 800.
// Même règle que côté navigateur (index.html / inscription.html) :
// à modifier simultanément des deux côtés.
const COMMISSION_MIN_FCFA = 300;
const TAUX_COMMISSION_PCT = 8;
function calculerCommissionPrimeService(prixBase: number): number {
  const base = Math.max(0, Math.round(Number(prixBase) || 0));
  if (base <= 0) return 0;
  if (base < COMMISSION_MIN_FCFA) return COMMISSION_MIN_FCFA;
  const multipleDe100 = Math.ceil((base * TAUX_COMMISSION_PCT) / 10000) * 100;
  return Math.round(Math.min(Math.max(COMMISSION_MIN_FCFA, multipleDe100), base) / 100) * 100;
}
const rateState = new Map<string, { started: number; count: number }>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_REQUESTS = 20;

type RawItem = { id?: unknown; quantite?: unknown };
type SafeItem = { id: number; quantite: number };
type Product = {
  id: number;
  nom: string | null;
  prix: number | null;
  stock: number | null;
  masque: boolean | null;
  image_url: string | null;
  adresse: string | null;
  lat: number | null;
  lng: number | null;
  nom_boutique: string | null;
  telephone_boutique: string | null;
  telephone: string | null;
  commission: number | null;
};
type CanonicalItem = {
  id: number;
  nom: string;
  prix: number;
  quantite: number;
  image_url: string | null;
  adresse: string | null;
  lat: number | null;
  lng: number | null;
  nom_boutique: string;
  telephone_boutique: string | null;
  commission: number;
};
type Shop = {
  name: string;
  phone: string | null;
  articles: string[];
  items: CanonicalItem[];
  amount: number;
  commission: number;
  adresse: string | null;
  lat: number | null;
  lng: number | null;
};

function corsHeaders(req: Request): Headers {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://roimtrmt-stack.github.io";
  return new Headers({
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
    "Vary": "Origin",
  });
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  const headers = corsHeaders(req);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function numberOrNull(value: unknown): number | null {
  // PIÈGE JS : Number(null) === 0, donc sans ce garde-fou, le "lat": null du
  // navigateur devenait 0 côté serveur et était rejeté comme « Position GPS invalide »
  // même avec le correctif GPS facultatif. null / undefined / "" = valeur absente.
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validStorageImage(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.origin === STORAGE_ORIGIN &&
      url.pathname.startsWith("/storage/v1/object/public/photos-articles/");
  } catch {
    return false;
  }
}

function rateLimited(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const key = forwarded.split(",")[0].trim() || "unknown";
  const now = Date.now();
  const current = rateState.get(key);
  if (!current || now - current.started >= RATE_WINDOW_MS) {
    rateState.set(key, { started: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > RATE_MAX_REQUESTS;
}

function normalizeMaliPhone(value: unknown): string | null {
  const raw = text(value, 40);
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8) return `+223${digits}`;
  if (digits.length === 11 && digits.startsWith("223")) return `+${digits}`;
  return null;
}

function maliPhoneDigits(value: string): string {
  return value.replace(/\D/g, "").replace(/^223/, "").slice(-8);
}

function createAckToken(): string {
  // 128 bits aléatoires : suffisamment opaque et assez court pour conserver
  // le lien d’activation complet dans un SMS limité à 160 caractères.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function clipWithSuffix(prefix: string, suffix: string, max: number): string {
  const separator = " | ";
  if (prefix.length + separator.length + suffix.length <= max) {
    return `${prefix}${separator}${suffix}`;
  }
  const available = Math.max(0, max - separator.length - suffix.length - 1);
  return `${prefix.slice(0, available)}…${separator}${suffix}`;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 8_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSafeImage(url: string): Promise<Blob | null> {
  try {
    const response = await fetchWithTimeout(url, { method: "GET", redirect: "error" }, 5_000);
    if (!response.ok) return null;
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_IMAGE_BYTES) return null;
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) return null;
    const blob = await response.blob();
    return blob.size <= MAX_IMAGE_BYTES ? blob : null;
  } catch {
    return null;
  }
}

type DeliveryResult = {
  target: string;
  delivered: boolean;
  reason: string;
};

type ImageAttachment = {
  item: CanonicalItem;
  blob: Blob;
  filename: string;
};

function imageExtension(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

async function sendDiscord(
  webhookUrl: string,
  payload: Record<string, unknown>,
  attachments: ImageAttachment[] = [],
): Promise<boolean> {
  if (attachments.length === 0) {
    const response = await fetchWithTimeout(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.ok;
  }
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  attachments.forEach((attachment, index) => {
    form.append(`files[${index}]`, attachment.blob, attachment.filename);
  });
  const response = await fetchWithTimeout(webhookUrl, { method: "POST", body: form }, 20_000);
  return response.ok;
}

async function sendTextBee(phone: string, message: string): Promise<DeliveryResult> {
  const apiKey = Deno.env.get("TEXTBEE_API_KEY");
  if (!apiKey) return { target: phone, delivered: false, reason: "TEXTBEE_API_KEY absent" };
  const payload: Record<string, unknown> = {
    recipients: [phone],
    message: clip(message, 1_000),
  };
  const deviceId = text(Deno.env.get("TEXTBEE_DEVICE_ID"), 120);
  if (deviceId) payload.deviceId = deviceId;
  try {
    const response = await fetchWithTimeout("https://api.textbee.dev/api/v1/gateway/send-sms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });
    return {
      target: phone,
      delivered: response.ok,
      reason: response.ok ? "accepted" : `TextBee HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      target: phone,
      delivered: false,
      reason: error instanceof Error ? error.message.slice(0, 160) : "exception TextBee",
    };
  }
}

function orangeCommandMessage(
  commandId: string,
  shop: Shop,
  clientName: string,
  clientPhone: string,
  quartier: string,
  precision: string | null,
  mapUrl: string,
  activationUrl: string,
): string {
  const articleSummary = shop.items
    .map((item) => `${clip(item.nom, 42)} x${item.quantite}`)
    .join(", ");
  const prefix = [
    `Prime Service commande #${commandId.slice(-8)}`,
    `Articles: ${articleSummary}`,
    `À recevoir du client: ${Math.round(shop.amount).toLocaleString("fr-FR")} FCFA`,
    `Client: ${clip(clientName, 38)} ${clip(clientPhone, 18)}`,
    `Quartier: ${clip(quartier, 70)}`,
    `Précision: ${clip(precision || "Aucune", 70)}`,
    `Carte: ${mapUrl}`,
  ].join(" | ");
  return clipWithSuffix(prefix, `Activer: ${activationUrl}`, 160);
}

async function sendBoutiqueSms(
  phone: string,
  textBeeMessage: string,
  orangeMessage: string,
): Promise<Record<string, DeliveryResult>> {
  const provider = text(Deno.env.get("SMS_PROVIDER"), 20).toLowerCase() || "textbee";
  const useOrange = orangeSmsEnabled();
  const useTextBee = provider === "textbee" || provider === "both" || (!useOrange && provider !== "none");
  const results: Record<string, DeliveryResult> = {};
  if (useTextBee) results.textbee = await sendTextBee(phone, textBeeMessage);
  if (useOrange) results.orange = await sendOrangeSms(phone, orangeMessage);
  if (Object.keys(results).length === 0) {
    results.sms = { target: phone, delivered: false, reason: "aucun fournisseur SMS activé" };
  }
  return results;
}

function googleMapsUrl(latitude: number | null, longitude: number | null): string {
  if(!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

function groupByShop(items: CanonicalItem[]): Shop[] {
  const shops = new Map<string, Shop>();
  for (const item of items) {
    const name = item.nom_boutique || "Boutique";
    const phone = normalizeMaliPhone(item.telephone_boutique);
    const key = `${name}|${phone || ""}`;
    const existing = shops.get(key) || {
      name,
      phone,
      articles: [],
      items: [],
      amount: 0,
      commission: 0,
      lat: item.lat,
      lng: item.lng,
      adresse: item.adresse,
    };
    existing.articles.push(`${item.nom} x${item.quantite}`);
    existing.items.push(item);
    // Paiement direct à la boutique : le client envoie le prix affiché (articles,
    // commission incluse) sur le numéro Orange Money de la boutique concernée.
    existing.amount += item.prix * item.quantite;
    existing.commission += item.commission * item.quantite;
    shops.set(key, existing);
  }
  return [...shops.values()].slice(0, 30);
}

async function queueBoutiqueNotifications(
  commandId: string,
  shops: Shop[],
  clientName: string,
  clientPhone: string,
  quartier: string,
  precision: string | null,
  mapUrl: string,
): Promise<Map<string, string>> {
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const activationByPhone = new Map<string, string>();
  const rows = shops.filter((shop) => shop.phone).map((shop) => {
    const ackToken = createAckToken();
    activationByPhone.set(maliPhoneDigits(shop.phone!), `${SITE_ORIGIN}/?boutique_token=${encodeURIComponent(ackToken)}`);
    const activationUrl = `${SITE_ORIGIN}/?boutique_token=${encodeURIComponent(ackToken)}`;
    return {
      commande_id: commandId,
      nom_boutique: shop.name,
      telephone_boutique: maliPhoneDigits(shop.phone!),
      message: [
        `Prime Service — commande #${commandId}`,
        `Boutique : ${clip(shop.name, 100)}`,
        `Adresse boutique : ${clip(shop.adresse || "Non renseignée", 240)}`,
        "Articles à préparer :",
        ...shop.items.map((item) => `• ${clip(item.nom, 100)} x${item.quantite}`),
        `Montant à recevoir du client : ${Math.round(shop.amount).toLocaleString("fr-FR")} FCFA (Orange Money vers votre numéro)`,
        `Client : ${clip(clientName, 60)} — ${clip(clientPhone, 24)}`,
        `Quartier de livraison : ${clip(quartier, 160)}`,
        `Précision de livraison : ${clip(precision || "Aucune précision fournie", 240)}`,
        `Carte client : ${mapUrl}`,
        `Activer les relances du site : ${activationUrl}`,
      ].join("\n"),
      statut: "en_attente",
      tentative: 0,
      prochaine_tentative: new Date().toISOString(),
      ack_token: ackToken,
    };
  });
  if (rows.length === 0) return activationByPhone;

  const { error } = await supabaseAdmin.from("notifications_boutiquiers").insert(rows);
  if (error) {
    console.error("[boutiquier-retries] création file impossible", commandId, error.message);
    return new Map();
  }

  // Le cron assure la reprise chaque minute ; cet appel lance cependant la première
  // tentative sans attendre le prochain tick. Le service_role reste côté serveur.
  try {
    await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/notifier-boutiquier`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: "{}",
    }, 10_000);
  } catch (error) {
    console.error("[boutiquier-retries] premier passage différé", commandId, error instanceof Error ? error.message : error);
  }
  return activationByPhone;
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;
    const response = await fetchWithTimeout(url, {
      headers: { "User-Agent": "PrimeService/1.0 contact-admin" },
    }, 4_000);
    if (!response.ok) return "Position GPS enregistrée";
    const body = await response.json();
    return text(body?.display_name, 300) || "Position GPS enregistrée";
  } catch {
    return "Position GPS enregistrée";
  }
}

// Totaux de commission du cycle de collecte en cours, par boutique (nom|téléphone).
// Cycle calé sur la collecte du SAMEDI : de dimanche 00:00 UTC (Bamako est à
// UTC+0) à samedi 23:59. Après la collecte du samedi, le compteur repart à
// zéro le dimanche. La commande courante est déjà insérée dans `commandes`
// avant cet appel, donc le total l'inclut.
async function commissionsParBoutiqueCetteSemaine(
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<Map<string, number>> {
  const maintenant = new Date();
  const jour = maintenant.getUTCDay(); // 0 = dimanche → début du cycle
  const dimanche = new Date(Date.UTC(
    maintenant.getUTCFullYear(),
    maintenant.getUTCMonth(),
    maintenant.getUTCDate() - jour,
    0, 0, 0, 0,
  ));
  const map = new Map<string, number>();
  const TAILLE_LOT = 3_000;
  for (let depart = 0; ; depart += TAILLE_LOT) {
    const { data, error } = await supabaseAdmin
      .from("commandes")
      .select("articles")
      .gte("created_at", dimanche.toISOString())
      .range(depart, depart + TAILLE_LOT - 1);
    if (error) throw new Error(`lecture commandes impossible : ${error.message}`);
    if (!data || data.length === 0) break;
    for (const ligne of data) {
      const articles = Array.isArray(ligne?.articles) ? ligne.articles : [];
      for (const article of articles) {
        if (!article || typeof article !== "object") continue;
        const item = article as Record<string, unknown>;
        const nom = text(item.nom_boutique, 120) || "Boutique";
        const phone = normalizeMaliPhone(text(item.telephone_boutique || item.telephone, 40));
        const cle = `${nom}|${phone || ""}`;
        const commission = Math.max(0, numberOrNull(item.commission) ?? 0);
        const quantite = Math.max(1, Math.round(numberOrNull(item.quantite) || 1));
        map.set(cle, (map.get(cle) ?? 0) + commission * quantite);
      }
    }
    if (data.length < TAILLE_LOT) break;
  }
  return map;
}

async function notifyInBackground(input: {
  commandId: string;
  createdAt: string;
  nom: string;
  tel: string;
  quartier: string;
  precision: string | null;
  lat: number | null;
  lng: number | null;
  total: number;
  items: CanonicalItem[];
  shops: Shop[];
}): Promise<void> {
  try {
    const shops = input.shops;
    // GPS facultatif : sans coordonnées, l'adresse du client est le quartier saisi.
    const positionGPSValide = input.lat !== null && input.lng !== null;
    const address = positionGPSValide ? await reverseGeocode(input.lat, input.lng) : "";
    const mapUrl = positionGPSValide ? googleMapsUrl(input.lat, input.lng) : "";
    const activationByPhone = await queueBoutiqueNotifications(input.commandId, shops, input.nom, input.tel, input.quartier, input.precision, mapUrl);
    const commissionTotal = input.items.reduce(
      (sum, item) => sum + item.commission * item.quantite,
      0,
    );
    let hebdo: Map<string, number> | null = null;
    let commissionHebdoTotale = commissionTotal;
    try {
      hebdo = await commissionsParBoutiqueCetteSemaine(createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY));
      commissionHebdoTotale = [...hebdo.values()].reduce((somme, valeur) => somme + valeur, 0);
    } catch (erreurHebdo) {
      console.error("[commission hebdo] totals indisponibles", erreurHebdo instanceof Error ? erreurHebdo.message : erreurHebdo);
    }
    const lines = input.items.map((item) => {
      const displayedAmount = item.prix * item.quantite;
      const commissionAmount = item.commission * item.quantite;
      return [
        `• ${clip(item.nom, 100)} x${item.quantite}`,
        `  Prix affiché client : ${displayedAmount.toLocaleString("fr-FR")} FCFA`,
        `  Commission : ${commissionAmount.toLocaleString("fr-FR")} FCFA`,
      ].join("\n");
    });
    const shopLines = shops.map((shop) => {
      const shopMapUrl = googleMapsUrl(shop.lat, shop.lng);
      const numeroBoutiqueFormate = shop.phone
        ? clip(maliPhoneDigits(shop.phone).replace(/(\d{2})(?=\d)/g, "$1 ").trim(), 20)
        : "non renseigné";
      const cleBoutique = `${shop.name}|${shop.phone || ""}`;
      const totalSemaine = Math.round((hebdo?.get(cleBoutique) ?? shop.commission) || 0);
      return [
        `🏪 **${clip(shop.name, 80)}**`,
        `   Numéro Orange Money boutique : ${numeroBoutiqueFormate}`,
        `   Adresse boutique : ${clip(shop.adresse || "Non renseignée", 240)}`,
        ...(shopMapUrl ? [`   🗺️ **Carte boutique :** ${shopMapUrl}`] : []),
        `   💠 Paiement reçu du client (Orange Money vers la boutique) : ${Math.round(shop.amount).toLocaleString("fr-FR")} FCFA`,
        `   🧾 Commission de cette commande (à collecter auprès du boutiquier) : ${Math.round(shop.commission).toLocaleString("fr-FR")} FCFA`,
        `   🗓️ Total commission dû par cette boutique pour votre collecte du samedi : ${totalSemaine.toLocaleString("fr-FR")} FCFA`,
      ].join("\n");
    });
    const created = new Date(input.createdAt).toLocaleString("fr-FR", {
      timeZone: "Africa/Bamako",
    });
    const content = clip([
      "🛒 **NOUVELLE COMMANDE — Prime Service**",
      `🆔 **Commande :** ${input.commandId}`,
      `🕒 **Heure :** ${created}`,
      `👤 **Client :** ${clip(input.nom, 120)}`,
      `📞 **Téléphone :** ${clip(input.tel, 40)}`,
      `📍 **Adresse :** ${address || input.quartier || "Non précisée"}`,
      `🗺️ **Carte :** ${mapUrl || "Non disponible (GPS facultatif non partagé)"}`,
      "",
      "📦 **Articles et répartition financière propriétaire :**",
      ...lines,
      "",
      ...shopLines,
      "",
      `💰 **TOTAL CLIENT :** ${input.total.toLocaleString("fr-FR")} FCFA`,
      `🧾 **COMMISSION TOTALE DE CETTE COMMANDE (à collecter) :** ${Math.round(commissionTotal).toLocaleString("fr-FR")} FCFA`,
      `🗓️ **COMMISSION TOTALE À COLLECTER CE SAMEDI (toutes boutiques) :** ${Math.round(commissionHebdoTotale).toLocaleString("fr-FR")} FCFA`,
      "",
      "💳 **PAIEMENT CLIENT À RECEVOIR**",
      `Le client paie CHAQUE boutique directement sur son numéro Orange Money (aucune commission n'est payée par le client) :`,
      ...shops.map((shop) => {
        const numeroFormate = shop.phone
          ? maliPhoneDigits(shop.phone).replace(/(\d{2})(?=\d)/g, "$1 ").trim()
          : "non renseigné";
        return `• ${clip(shop.name, 80)} : le client envoie **${Math.round(shop.amount).toLocaleString("fr-FR")} FCFA** au numéro **${numeroFormate}**.`;
      }),
      "Composer #144#, choisir Transfert/Envoyer, saisir le numéro de la boutique et le montant, vérifier le bénéficiaire, puis valider avec le code secret sur le téléphone.",
      "Recoltez ces commissions chaque samedi auprès de chaque boutiquier (totaux ci-dessus) ; le compteur repart à zéro le dimanche suivant. Remettez ensuite à chaque boutique le paiement de son client.",
      `Pour recevoir la commission collectée, votre numéro Orange Money reste : **${ORANGE_PAYMENT_NUMBER.replace(/(\d{2})(?=\d)/g, "$1 ")}**.`,
      "Ne jamais communiquer ni enregistrer le code secret. Vérifier le SMS ou le solde avant de considérer le paiement comme confirmé.",
    ].join("\n"), 1_950);

    const imageCache = new Map<number, ImageAttachment | null>();
    const getImageAttachment = async (item: CanonicalItem): Promise<ImageAttachment | null> => {
      if (!item.image_url) return null;
      if (imageCache.has(item.id)) return imageCache.get(item.id) ?? null;
      const blob = await fetchSafeImage(item.image_url);
      const attachment = blob
        ? {
          item,
          blob,
          filename: `article-${item.id}.${imageExtension(blob.type)}`,
        }
        : null;
      imageCache.set(item.id, attachment);
      return attachment;
    };
    const ownerAttachments = (await Promise.all(
      input.items.filter((item) => item.image_url).slice(0, 10).map(getImageAttachment),
    )).filter((item): item is ImageAttachment => item !== null);
    const embeds = ownerAttachments.map((attachment) => ({
      title: `${clip(attachment.item.nom, 180)} x${attachment.item.quantite}`,
      description: [
        `Prix affiché : ${(attachment.item.prix * attachment.item.quantite).toLocaleString("fr-FR")} FCFA`,
        `Prix payé par le client (Orange Money vers la boutique) : ${(attachment.item.prix * attachment.item.quantite).toLocaleString("fr-FR")} FCFA`,
        `Commission : ${(attachment.item.commission * attachment.item.quantite).toLocaleString("fr-FR")} FCFA`,
      ].join("\n"),
      image: { url: `attachment://${attachment.filename}` },
      color: 0x2563eb,
    }));

    const ownerWebhook = Deno.env.get("DISCORD_WEBHOOK_URL");
    let ownerResult: DeliveryResult = {
      target: "owner-discord",
      delivered: false,
      reason: "DISCORD_WEBHOOK_URL absent",
    };
    if (ownerWebhook) {
      try {
        const discordOk = await sendDiscord(ownerWebhook, {
          content,
          embeds,
          allowed_mentions: { parse: [] },
        }, ownerAttachments);
        ownerResult = {
          target: "owner-discord",
          delivered: discordOk,
          reason: discordOk ? "accepted avec photos jointes" : "Discord HTTP error",
        };
      } catch (error) {
        ownerResult.reason = error instanceof Error ? error.message.slice(0, 160) : "exception Discord";
      }
    }

    const shopResults = await Promise.all(shops.map(async (shop) => {
      if (!shop.phone) {
        return {
          target: shop.name,
          sms: { target: shop.name, delivered: false, reason: "numéro malien invalide ou absent" },
        };
      }
      const boutiqueText = [
        `Prime Service — nouvelle commande #${input.commandId}`,
        `Boutique : ${clip(shop.name, 100)}`,
        "Articles à préparer :",
        ...shop.items.map((item) => `• ${clip(item.nom, 100)} x${item.quantite}`),
        `Montant à recevoir du client : ${Math.round(shop.amount).toLocaleString("fr-FR")} FCFA (Orange Money vers votre numéro)`,
        `Client : ${clip(input.nom, 60)} — ${clip(input.tel, 24)}`,
        `Quartier de livraison : ${clip(input.quartier, 160)}`,
        `Précision de livraison : ${clip(input.precision || "Aucune précision fournie", 240)}`,
        `Carte client : ${mapUrl}`,
        `Activer les relances du site : ${activationByPhone.get(shop.phone) || `${SITE_ORIGIN}/`}`,
      ].join(" | ");
      const activationUrl = activationByPhone.get(shop.phone) || `${SITE_ORIGIN}/`;
      const orangeMessage = orangeCommandMessage(
        input.commandId,
        shop,
        input.nom,
        input.tel,
        input.quartier,
        input.precision,
        mapUrl,
        activationUrl,
      );
      const sms = await sendBoutiqueSms(shop.phone, boutiqueText, orangeMessage);
      return { target: shop.name, sms };
    }));
  } catch (error) {
    console.error("Erreur notifications commande", input.commandId, error);
  }
}

function runInBackground(task: Promise<void>): void {
  const runtime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(task);
  else void task;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "Méthode non autorisée" }, 405);
  if (rateLimited(req)) return jsonResponse(req, { error: "Trop de demandes, réessayez plus tard" }, 429);

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return jsonResponse(req, { error: "Requête trop volumineuse" }, 413);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(req, { error: "Configuration serveur incomplète" }, 500);
  }

  try {
    const body = await req.json();
    const nom = text(body?.nom, 120);
    const tel = text(body?.tel, 40);
    const quartier = text(body?.quartier_client, 160);
    const precision = text(body?.precision_livraison, 300) || null;
    const paiement = text(body?.paiement, 40) || "À la livraison";
    // GPS facultatif : des coordonnées absentes (null) sont acceptées ;
    // des coordonnées fournies doivent rester valides.
    const latBrut = numberOrNull(body?.lat);
    const lngBrut = numberOrNull(body?.lng);
    const positionFournie = latBrut !== null && lngBrut !== null;
    const lat = positionFournie ? latBrut : null;
    const lng = positionFournie ? lngBrut : null;
    if (positionFournie && (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0))) {
      return jsonResponse(req, { error: "Position GPS invalide" }, 400);
    }
    const declaredTotal = numberOrNull(body?.totalCommande);
    const rawPanier = Array.isArray(body?.panier) ? body.panier as RawItem[] : [];
    if (!nom || !tel || !quartier ||
      declaredTotal === null || declaredTotal <= 0 || rawPanier.length < 1 || rawPanier.length > MAX_PANIER_ITEMS) {
      return jsonResponse(req, { error: "Données de commande invalides" }, 400);
    }

    const items: SafeItem[] = [];
    for (const raw of rawPanier) {
      const id = Number(raw?.id);
      const quantite = Number(raw?.quantite);
      if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(quantite) || quantite < 1 || quantite > 99) {
        return jsonResponse(req, { error: "Article ou quantité invalide" }, 400);
      }
      items.push({ id, quantite });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const ids = [...new Set(items.map((item) => item.id))];
    const { data: products, error: productError } = await supabaseAdmin
      .from("produits")
      .select("id, nom, prix, stock, masque, image_url, adresse, lat, lng, nom_boutique, telephone_boutique, telephone, commission")
      .in("id", ids)
      .limit(MAX_PANIER_ITEMS);
    if (productError || !products || products.length !== ids.length) {
      return jsonResponse(req, { error: "Article indisponible" }, 409);
    }

    const productsById = new Map<number, Product>(
      (products as Product[]).map((product) => [Number(product.id), product]),
    );

    // Note : la liste des boutiques bloquées est petite (quelques lignes) ;
    // on la charge intégralement puis on compare en JS en ignorant la casse
    // et les espaces, comme le navigateur.
    const nomsCommande = [...new Set((products as Product[])
      .map((produit) => String(produit.nom_boutique || "").trim().toLocaleLowerCase("fr-FR").replace(/\s+/g, " "))
      .filter(Boolean))];
    if (nomsCommande.length > 0) {
      const { data: lignesBloquees, error: erreurBlocage } = await supabaseAdmin
        .from("boutiques_bloquees")
        .select("nom_boutique")
        .limit(200);
      if (erreurBlocage) {
        console.error("[blocage] lecture des boutiques bloquées impossible", erreurBlocage.message);
      } else {
        const bloquees = new Set((lignesBloquees || []).map((ligne) =>
          String(ligne.nom_boutique || "").trim().toLocaleLowerCase("fr-FR").replace(/\s+/g, " ")));
        const nomsInterdits = nomsCommande.filter((nom) => bloquees.has(nom));
        if (nomsInterdits.length > 0) {
          return jsonResponse(req, { error: "Boutique actuellement indisponible — contactez Prime Service." }, 409);
        }
      }
    }

    const canonicalItems: CanonicalItem[] = [];
    let canonicalTotal = 0;
    for (const item of items) {
      const product = productsById.get(item.id);
      const price = numberOrNull(product?.prix);
      if (!product || product.masque || price === null) {
        return jsonResponse(req, { error: "Article indisponible" }, 409);
      }
      // Recalcul de la commission par paliers à partir du prix de base :
      // base = prix stocké − commission stockée, puis commission recalculée.
      // Si elle diffère (article hérité non migré), le catalogue est remis à
      // niveau et la commande est refusée jusqu'au prochain chargement.
      const commissionStockee = Math.max(0, numberOrNull(product.commission) ?? 0);
      const prixBase = Math.max(0, Math.round(price - commissionStockee));
      const commission = Math.max(0, calculerCommissionPrimeService(prixBase));
      const prixAffiche = prixBase + commission;
      if (prixAffiche !== price || commission !== commissionStockee) {
        const { error: erreurMajCatalogue } = await supabaseAdmin
          .from("produits")
          .update({ commission, prix: prixAffiche })
          .eq("id", product.id);
        if (erreurMajCatalogue) {
          console.error("[catalogue] mise à jour commission impossible", product.id, erreurMajCatalogue.message);
        }
      }
      canonicalTotal += prixAffiche * item.quantite;
      canonicalItems.push({
        id: item.id,
        nom: text(product.nom, 160) || "Article",
        prix: prixAffiche,
        quantite: item.quantite,
        image_url: validStorageImage(product.image_url) ? product.image_url : null,
        adresse: text(product.adresse, 240) || null,
        lat: numberOrNull(product.lat),
        lng: numberOrNull(product.lng),
        nom_boutique: text(product.nom_boutique, 120) || "Boutique",
        telephone_boutique: text(product.telephone_boutique || product.telephone, 40) || null,
        commission,
      });
    }
    if (Math.abs(canonicalTotal - declaredTotal) > 1) {
      return jsonResponse(req, { error: "Total de commande invalide — le catalogue a été mis à jour, rechargez la page et réessayez" }, 400);
    }

    let commandId = "";
    let createdAt = new Date().toISOString();
    try {
      const { data: command, error: commandError } = await supabaseAdmin
        .from("commandes")
        .insert({
          nom_client: nom,
          telephone_client: tel,
          quartier_client: quartier,
          precision_livraison: precision,
          paiement,
          lat_client: lat,
          lng_client: lng,
          articles: canonicalItems,
          total: Math.round(canonicalTotal),
        })
        .select("id, created_at")
        .single();
      if (commandError || !command) throw commandError || new Error("Commande non créée");
      commandId = String(command.id);
      createdAt = String(command.created_at || createdAt);
    } catch (error) {
      console.error("Commande non enregistrée, stock restauré", error);
      return jsonResponse(req, { error: "Commande impossible à enregistrer" }, 500);
    }

    
    const shops = groupByShop(canonicalItems);
    const commissionTotale = Math.round(
      canonicalItems.reduce((somme, item) => somme + item.commission * item.quantite, 0),
    );
    // Paiement direct à la boutique : le client envoie le prix affiché (articles,
    // commission incluse) au numéro Orange Money de chaque boutique concernée.
    const boutiquesPayees = shops.map((shop) => ({
      nom: shop.name,
      telephone: shop.phone ? maliPhoneDigits(shop.phone) : null,
      montant: Math.round(shop.amount),
      commission: Math.round(shop.commission),
      articles: shop.articles.slice(0, 30),
    }));

    runInBackground(notifyInBackground({
      commandId,
      createdAt,
      nom,
      tel,
      quartier,
      precision,
      lat,
      lng,
      total: Math.round(canonicalTotal),
      items: canonicalItems,
      shops,
    }));

    return jsonResponse(req, {
      success: true,
      commandId,
      total: Math.round(canonicalTotal),
      commission: commissionTotale,
      boutiques: boutiquesPayees,
      notifications: "background",
    }, 201);
  } catch (error) {
    console.error("Erreur dans envoyer-commande", error);
    return jsonResponse(req, { error: "Requête impossible à traiter" }, 500);
  }
});
