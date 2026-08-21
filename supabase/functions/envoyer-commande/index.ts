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
  amount: number;
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
  const response = await fetchWithTimeout(url, { method: "GET", redirect: "error" }, 5_000);
  if (!response.ok) return null;
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_IMAGE_BYTES) return null;
  const blob = await response.blob();
  return blob.size <= MAX_IMAGE_BYTES ? blob : null;
}

async function sendDiscord(webhookUrl: string, payload: Record<string, unknown>): Promise<boolean> {
  const response = await fetchWithTimeout(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.ok;
}

async function sendTextBee(phone: string, message: string): Promise<boolean> {
  const apiKey = Deno.env.get("TEXTBEE_API_KEY");
  if (!apiKey) return false;
  const payload: Record<string, unknown> = {
    recipients: [phone],
    message: clip(message, 1_000),
  };
  const deviceId = text(Deno.env.get("TEXTBEE_DEVICE_ID"), 120);
  if (deviceId) payload.deviceId = deviceId;
  const response = await fetchWithTimeout("https://api.textbee.dev/api/v1/gateway/send-sms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });
  return response.ok;
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
      amount: 0,
      lat: item.lat,
      lng: item.lng,
    };
    existing.articles.push(`${item.nom} x${item.quantite}`);
    existing.amount += Math.max(0, item.prix - item.commission) * item.quantite;
    shops.set(key, existing);
  }
  return [...shops.values()].slice(0, 30);
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
    const lines = input.items.map((item) =>
      `• ${clip(item.nom, 100)} x${item.quantite} — ${(item.prix * item.quantite).toLocaleString("fr-FR")} FCFA`
    );
    const shopLines = shops.map((shop) =>
      `🏪 ${clip(shop.name, 80)} — ${(Math.round(shop.amount)).toLocaleString("fr-FR")} FCFA`
    );
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
      "📦 **Articles :**",
      ...lines,
      "",
      ...shopLines,
      `💰 **TOTAL :** ${input.total.toLocaleString("fr-FR")} FCFA`,
    ].join("\n"), 1_950);
    const embeds = input.items
      .filter((item) => item.image_url)
      .slice(0, 10)
      .map((item) => ({
        title: `${clip(item.nom, 180)} x${item.quantite}`,
        description: `${(item.prix * item.quantite).toLocaleString("fr-FR")} FCFA`,
        image: { url: item.image_url },
        color: 0x2563eb,
      }));

    const ownerWebhook = Deno.env.get("DISCORD_WEBHOOK_URL");
    if (ownerWebhook) {
      const discordOk = await sendDiscord(ownerWebhook, {
        content,
        embeds,
        allowed_mentions: { parse: [] },
      });
      if (!discordOk) console.error("Discord propriétaire a refusé la commande", input.commandId);
    } else {
      console.error("DISCORD_WEBHOOK_URL manquant", input.commandId);
    }

    for (const shop of shops) {
      if (!shop.phone) {
        console.warn("Boutique sans numéro malien valide", shop.name);
        continue;
      }
      const sms = [
        `Prime Service commande #${input.commandId}`,
        shop.articles.join(", "),
        `Montant boutique: ${Math.round(shop.amount).toLocaleString("fr-FR")} FCFA`,
        `Client: ${clip(input.nom, 60)} ${clip(input.tel, 24)}`,
        `Carte: ${mapUrl}`,
      ].join(" | ");
      try {
        const smsOk = await sendTextBee(shop.phone, sms);
        if (!smsOk) console.error("SMS boutique non envoyé", shop.name, input.commandId);
      } catch (error) {
        console.error("Erreur SMS boutique", shop.name, error);
      }
    }
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
