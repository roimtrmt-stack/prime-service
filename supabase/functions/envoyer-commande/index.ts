import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
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

function normalizeWhatsAppPhone(value: unknown): string | null {
  const raw = text(value, 40);
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8) return `223${digits}`;
  if (digits.length === 11 && digits.startsWith("223")) return digits;
  return null;
}

async function uploadWhatsAppMedia(
  endpoint: string,
  token: string,
  attachment: ImageAttachment,
): Promise<string | null> {
  if (!["image/jpeg", "image/png"].includes(attachment.blob.type) || attachment.blob.size > 5_000_000) {
    return null;
  }
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", attachment.blob.type);
  form.append("file", attachment.blob, attachment.filename);
  try {
    const response = await fetchWithTimeout(`${endpoint}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }, 20_000);
    if (!response.ok) return null;
    const body = await response.json();
    return text(body?.id, 200) || null;
  } catch {
    return null;
  }
}

async function sendWhatsApp(
  phone: string,
  shop: Shop,
  clientName: string,
  clientPhone: string,
  mapUrl: string,
  images: ImageAttachment[],
): Promise<DeliveryResult> {
  const token = text(Deno.env.get("WHATSAPP_TOKEN"), 4_000);
  const phoneId = text(
    Deno.env.get("WHATSAPP_PHONE_ID") || Deno.env.get("WHATSAPP_PHONE_NUMBER_ID"),
    120,
  );
  const templateName = text(Deno.env.get("WHATSAPP_TEMPLATE_NAME"), 120);
  const language = text(Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE"), 20) || "fr";
  const target = `whatsapp:${phone}`;
  if (!token || !phoneId || !templateName) {
    return { target, delivered: false, reason: "WhatsApp non configuré (token, phone ID ou template absent)" };
  }
  const recipient = normalizeWhatsAppPhone(phone);
  if (!recipient) return { target, delivered: false, reason: "numéro WhatsApp malien invalide" };

  const graphVersion = text(Deno.env.get("WHATSAPP_GRAPH_VERSION"), 20) || "v26.0";
  const endpoint = `https://graph.facebook.com/${graphVersion}/${phoneId}`;
  const bodyParameters = [
    shop.name,
    clientName,
    clientPhone,
    shop.articles.join(", "),
    `${Math.round(shop.amount).toLocaleString("fr-FR")} FCFA`,
    mapUrl,
  ].map((value) => ({ type: "text", text: clip(value, 1_024) }));
  const components: Array<Record<string, unknown>> = [{ type: "body", parameters: bodyParameters }];
  const templateNeedsImageHeader = Deno.env.get("WHATSAPP_TEMPLATE_HEADER_IMAGE") === "true";
  if (templateNeedsImageHeader) {
    const firstImage = images[0];
    if (!firstImage) return { target, delivered: false, reason: "template WhatsApp image sans photo valide" };
    const mediaId = await uploadWhatsAppMedia(endpoint, token, firstImage);
    if (!mediaId) return { target, delivered: false, reason: "échec téléversement média WhatsApp" };
    components.unshift({ type: "header", parameters: [{ type: "image", image: { id: mediaId } }] });
  }

  try {
    const response = await fetchWithTimeout(`${endpoint}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: `+${recipient}`,
        type: "template",
        template: { name: templateName, language: { code: language }, components },
      }),
    }, 20_000);
    if (!response.ok) return { target, delivered: false, reason: `WhatsApp HTTP ${response.status}` };

    // Les images libres supplémentaires ne sont activées que si l’administrateur
    // confirme qu’une fenêtre de service WhatsApp est ouverte pour ce destinataire.
    if (Deno.env.get("WHATSAPP_ALLOW_FREEFORM_MEDIA") === "true") {
      for (const image of images.slice(0, 10)) {
        const mediaId = await uploadWhatsAppMedia(endpoint, token, image);
        if (!mediaId) continue;
        await fetchWithTimeout(`${endpoint}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: `+${recipient}`,
            type: "image",
            image: { id: mediaId, caption: clip(image.item.nom, 1_024) },
          }),
        }, 20_000);
      }
    }
    return { target, delivered: true, reason: "accepted" };
  } catch (error) {
    return {
      target,
      delivered: false,
      reason: error instanceof Error ? error.message.slice(0, 160) : "exception WhatsApp",
    };
  }
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
    };
    existing.articles.push(`${item.nom} x${item.quantite}`);
    existing.items.push(item);
    existing.amount += Math.max(0, item.prix - item.commission) * item.quantite;
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
  mapUrl: string,
): Promise<void> {
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const rows = shops.filter((shop) => shop.phone).map((shop) => ({
    commande_id: commandId,
    nom_boutique: shop.name,
    telephone_boutique: maliPhoneDigits(shop.phone!),
    message: [
      `Prime Service — commande #${commandId}`,
      `Boutique : ${clip(shop.name, 100)}`,
      "Articles à préparer :",
      ...shop.items.map((item) => `• ${clip(item.nom, 100)} x${item.quantite}`),
      `Montant NET à recevoir : ${Math.round(shop.amount).toLocaleString("fr-FR")} FCFA`,
      `Client : ${clip(clientName, 60)} — ${clip(clientPhone, 24)}`,
      `Carte client : ${mapUrl}`,
    ].join("\n"),
    statut: "en_attente",
    tentative: 0,
    prochaine_tentative: new Date().toISOString(),
    ack_token: createAckToken(),
  }));
  if (rows.length === 0) return;

  const { error } = await supabaseAdmin.from("notifications_boutiquiers").insert(rows);
  if (error) {
    console.error("[boutiquier-retries] création file impossible", commandId, error.message);
    return;
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

async function notifyInBackground(input: {
  commandId: string;
  createdAt: string;
  nom: string;
  tel: string;
  lat: number;
  lng: number;
  total: number;
  items: CanonicalItem[];
}): Promise<void> {
  try {
    const address = await reverseGeocode(input.lat, input.lng);
    const mapUrl = `https://www.google.com/maps?q=${input.lat},${input.lng}`;
    const shops = groupByShop(input.items);
    await queueBoutiqueNotifications(input.commandId, shops, input.nom, input.tel, mapUrl);
    const commissionTotal = input.items.reduce(
      (sum, item) => sum + item.commission * item.quantite,
      0,
    );
    const lines = input.items.map((item) => {
      const displayedAmount = item.prix * item.quantite;
      const shopAmount = Math.max(0, item.prix - item.commission) * item.quantite;
      const commissionAmount = item.commission * item.quantite;
      return [
        `• ${clip(item.nom, 100)} x${item.quantite}`,
        `  Prix affiché client : ${displayedAmount.toLocaleString("fr-FR")} FCFA`,
        `  À remettre à la boutique : ${shopAmount.toLocaleString("fr-FR")} FCFA`,
        `  Commission Prime Service : ${commissionAmount.toLocaleString("fr-FR")} FCFA`,
      ].join("\n");
    });
    const shopLines = shops.map((shop) => [
      `🏪 **${clip(shop.name, 80)}**`,
      `   À remettre à la boutique : ${Math.round(shop.amount).toLocaleString("fr-FR")} FCFA`,
      `   Commission à garder : ${Math.round(shop.commission).toLocaleString("fr-FR")} FCFA`,
    ].join("\n"));
    const created = new Date(input.createdAt).toLocaleString("fr-FR", {
      timeZone: "Africa/Bamako",
    });
    const content = clip([
      "🛒 **NOUVELLE COMMANDE — Prime Service**",
      `🆔 **Commande :** ${input.commandId}`,
      `🕒 **Heure :** ${created}`,
      `👤 **Client :** ${clip(input.nom, 120)}`,
      `📞 **Téléphone :** ${clip(input.tel, 40)}`,
      `📍 **Adresse :** ${address}`,
      `🗺️ **Carte :** ${mapUrl}`,
      "",
      "📦 **Articles et répartition financière propriétaire :**",
      ...lines,
      "",
      ...shopLines,
      `💰 **TOTAL CLIENT :** ${input.total.toLocaleString("fr-FR")} FCFA`,
      `🧾 **COMMISSION TOTALE À GARDER :** ${Math.round(commissionTotal).toLocaleString("fr-FR")} FCFA`,
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
        `À remettre : ${(Math.max(0, attachment.item.prix - attachment.item.commission) * attachment.item.quantite).toLocaleString("fr-FR")} FCFA`,
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
          whatsapp: { target: shop.name, delivered: false, reason: "numéro malien invalide ou absent" },
        };
      }
      const shopAttachments = (await Promise.all(
        shop.items.filter((item) => item.image_url).slice(0, 10).map(getImageAttachment),
      )).filter((item): item is ImageAttachment => item !== null);
      const boutiqueText = [
        `Prime Service — nouvelle commande #${input.commandId}`,
        `Boutique : ${clip(shop.name, 100)}`,
        "Articles à préparer :",
        ...shop.items.map((item) => `• ${clip(item.nom, 100)} x${item.quantite}`),
        `Montant NET à recevoir : ${Math.round(shop.amount).toLocaleString("fr-FR")} FCFA`,
        `Client : ${clip(input.nom, 60)} — ${clip(input.tel, 24)}`,
        `Carte client : ${mapUrl}`,
        `Activer les notifications du site : ${SITE_ORIGIN}/?boutique=${maliPhoneDigits(shop.phone)}`,
      ].join(" | ");
      const sms = await sendTextBee(shop.phone, boutiqueText);
      const whatsapp = await sendWhatsApp(
        shop.phone,
        shop,
        input.nom,
        input.tel,
        mapUrl,
        shopAttachments,
      );
      return { target: shop.name, sms, whatsapp };
    }));
    console.log("[notifications] commande traitée", JSON.stringify({
      commandId: input.commandId,
      owner: ownerResult,
      shops: shopResults,
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
    const paiement = text(body?.paiement, 40) || "À la livraison";
    const lat = numberOrNull(body?.lat);
    const lng = numberOrNull(body?.lng);
    const declaredTotal = numberOrNull(body?.totalCommande);
    const rawPanier = Array.isArray(body?.panier) ? body.panier as RawItem[] : [];
    if (!nom || !tel || !lat || !lng || lat < -90 || lat > 90 || lng < -180 || lng > 180 ||
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
      .select("id, nom, prix, stock, masque, image_url, adresse, lat, lng, nom_boutique, telephone_boutique, commission")
      .in("id", ids)
      .limit(MAX_PANIER_ITEMS);
    if (productError || !products || products.length !== ids.length) {
      return jsonResponse(req, { error: "Article indisponible" }, 409);
    }

    const productsById = new Map<number, Product>(
      (products as Product[]).map((product) => [Number(product.id), product]),
    );
    const canonicalItems: CanonicalItem[] = [];
    let canonicalTotal = 0;
    for (const item of items) {
      const product = productsById.get(item.id);
      const price = numberOrNull(product?.prix);
      const stock = numberOrNull(product?.stock);
      if (!product || product.masque || price === null || stock === null || stock < item.quantite) {
        return jsonResponse(req, { error: "Stock insuffisant ou article indisponible" }, 409);
      }
      const commission = Math.max(0, numberOrNull(product.commission) ?? 0);
      canonicalTotal += price * item.quantite;
      canonicalItems.push({
        id: item.id,
        nom: text(product.nom, 160) || "Article",
        prix: price,
        quantite: item.quantite,
        image_url: validStorageImage(product.image_url) ? product.image_url : null,
        adresse: text(product.adresse, 240) || null,
        lat: numberOrNull(product.lat),
        lng: numberOrNull(product.lng),
        nom_boutique: text(product.nom_boutique, 120) || "Boutique",
        telephone_boutique: text(product.telephone_boutique, 40) || null,
        commission,
      });
    }
    if (Math.abs(canonicalTotal - declaredTotal) > 1) {
      return jsonResponse(req, { error: "Total de commande invalide" }, 400);
    }

    const stockItems = items.map((item) => ({ id: item.id, quantite: item.quantite }));
    const { error: stockError } = await supabaseAdmin.rpc("decrement_stock_batch", { p_items: stockItems });
    if (stockError) return jsonResponse(req, { error: "Stock indisponible" }, 409);

    let commandId = "";
    let createdAt = new Date().toISOString();
    try {
      const { data: command, error: commandError } = await supabaseAdmin
        .from("commandes")
        .insert({
          nom_client: nom,
          telephone_client: tel,
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
      await supabaseAdmin.rpc("increment_stock_batch", { p_items: stockItems });
      console.error("Commande non enregistrée, stock restauré", error);
      return jsonResponse(req, { error: "Commande impossible à enregistrer" }, 500);
    }

    runInBackground(notifyInBackground({
      commandId,
      createdAt,
      nom,
      tel,
      lat,
      lng,
      total: Math.round(canonicalTotal),
      items: canonicalItems,
    }));

    return jsonResponse(req, {
      success: true,
      commandId,
      total: Math.round(canonicalTotal),
      notifications: "background",
    }, 201);
  } catch (error) {
    console.error("Erreur dans envoyer-commande", error);
    return jsonResponse(req, { error: "Requête impossible à traiter" }, 500);
  }
});
