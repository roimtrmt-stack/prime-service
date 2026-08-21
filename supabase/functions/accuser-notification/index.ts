import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const READ_DELAY_MS = 60 * 1000;
const NOTIFICATION_TTL_MS = 60 * 60 * 1000;
const STORAGE_ORIGIN = "https://kfxalpvbtbvkncztjwzc.supabase.co";
const ALLOWED_ORIGINS = new Set([
  "https://roimtrmt-stack.github.io",
  "https://primeservice.netlify.app",
  "http://localhost:4173",
  "http://localhost:5173",
]);

function corsHeaders(req: Request): Headers {
  const origin = req.headers.get("origin") || "";
  return new Headers({
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://roimtrmt-stack.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
    "Vary": "Origin",
  });
}

function response(req: Request, body: unknown, status = 200): Response {
  const headers = corsHeaders(req);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function safeText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function numberOrZero(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function phoneKey(value: unknown): string {
  return safeText(value, 40).replace(/\D/g, "").replace(/^223/, "").slice(-8);
}

function validImage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === STORAGE_ORIGIN &&
      url.pathname.startsWith("/storage/v1/object/public/photos-articles/") ? value : null;
  } catch {
    return null;
  }
}

async function loadDetails(
  supabase: ReturnType<typeof createClient>,
  notification: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const { data: command, error } = await supabase
    .from("commandes")
    .select("id, nom_client, telephone_client, lat_client, lng_client, articles, created_at")
    .eq("id", String(notification.commande_id || ""))
    .limit(1)
    .maybeSingle();
  if (error || !command) return null;

  const boutiquePhone = phoneKey(notification.telephone_boutique);
  const boutiqueName = safeText(notification.nom_boutique, 120);
  const rawArticles = Array.isArray(command.articles) ? command.articles : [];
  const matchingArticles = rawArticles.filter((article) => {
    if (!article || typeof article !== "object") return false;
    const item = article as Record<string, unknown>;
    const itemPhone = phoneKey(item.telephone_boutique || item.telephone);
    const itemName = safeText(item.nom_boutique, 120);
    return (boutiquePhone && itemPhone === boutiquePhone) || (!itemPhone && itemName === boutiqueName);
  });

  let totalNet = 0;
  const articles = matchingArticles.map((article) => {
    const item = article as Record<string, unknown>;
    const quantity = Math.max(1, Math.min(99, Math.floor(numberOrZero(item.quantite))));
    const net = Math.max(0, numberOrZero(item.prix) - numberOrZero(item.commission));
    totalNet += net * quantity;
    return {
      nom: safeText(item.nom, 160) || "Article",
      quantite: quantity,
      montant_net: Math.round(net * quantity),
      image_url: validImage(item.image_url),
    };
  });

  const adresse = matchingArticles
    .map((article) => safeText((article as Record<string, unknown>).adresse, 240))
    .find(Boolean) || "Non renseignée";

  return {
    id: String(command.id),
    boutique: boutiqueName || "Boutique",
    adresse_boutique: adresse,
    nom_client: safeText(command.nom_client, 120),
    telephone_client: safeText(command.telephone_client, 40),
    lat_client: numberOrZero(command.lat_client) || null,
    lng_client: numberOrZero(command.lng_client) || null,
    montant_net_total: Math.round(totalNet),
    articles,
    created_at: command.created_at,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return response(req, { error: "Méthode non autorisée" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return response(req, { error: "Configuration serveur incomplète" }, 500);

  try {
    const body = await req.json();
    const token = safeText(body?.token, 180);
    const action = safeText(body?.action, 20).toLowerCase() || "ack";
    if (token.length < 32) return response(req, { error: "Jeton d’accusé invalide" }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: notification, error: findError } = await supabase
      .from("notifications_boutiquiers")
      .select("id, nom_boutique, telephone_boutique, commande_id, acknowledged_at, read_started_at, created_at, statut")
      .eq("ack_token", token)
      .limit(1)
      .maybeSingle();
    if (findError) return response(req, { error: "Recherche impossible" }, 500);
    if (!notification) return response(req, { error: "Notification introuvable ou lien expiré" }, 404);

    const createdAtMs = Date.parse(String(notification.created_at || ""));
    const nowMs = Date.now();
    const expiresAtMs = Number.isFinite(createdAtMs) ? createdAtMs + NOTIFICATION_TTL_MS : nowMs + NOTIFICATION_TTL_MS;
    if (nowMs >= expiresAtMs) {
      return response(req, {
        error: "Cette notification a expiré après une heure.",
        code: "expired",
        expiresAt: new Date(expiresAtMs).toISOString(),
      }, 410);
    }

    let readStartedAt = notification.read_started_at ? String(notification.read_started_at) : "";
    if ((action === "details" || action === "start") && !readStartedAt) {
      readStartedAt = new Date(nowMs).toISOString();
      const { data: started, error: startError } = await supabase
        .from("notifications_boutiquiers")
        .update({ read_started_at: readStartedAt })
        .eq("id", notification.id)
        .is("read_started_at", null)
        .select("read_started_at")
        .maybeSingle();
      if (startError) return response(req, { error: "Début de lecture impossible" }, 500);
      if (started?.read_started_at) readStartedAt = String(started.read_started_at);
    }

    if (action === "details" || action === "start") {
      const details = action === "details" ? await loadDetails(supabase, notification) : null;
      if (action === "details" && !details) return response(req, { error: "Détails de commande indisponibles" }, 404);
      const remainingMs = Math.max(0, READ_DELAY_MS - (nowMs - Date.parse(readStartedAt)));
      return response(req, {
        success: true,
        status: notification.acknowledged_at ? "accusee" : "lecture_en_cours",
        readStartedAt,
        remainingSeconds: Math.ceil(remainingMs / 1000),
        expiresAt: new Date(expiresAtMs).toISOString(),
        command: details,
      });
    }

    if (action !== "ack") return response(req, { error: "Action invalide" }, 400);
    if (notification.acknowledged_at) {
      return response(req, { success: true, status: "accusee", message: "Commande déjà marquée comme vue." });
    }
    if (!readStartedAt) {
      return response(req, { error: "Ouvrez les détails de la commande avant de confirmer.", code: "read_timer_not_started" }, 409);
    }
    const elapsedMs = nowMs - Date.parse(readStartedAt);
    if (!Number.isFinite(elapsedMs) || elapsedMs < READ_DELAY_MS) {
      return response(req, {
        error: "Veuillez lire les détails pendant une minute avant de confirmer.",
        code: "read_too_soon",
        remainingSeconds: Math.ceil(Math.max(0, READ_DELAY_MS - elapsedMs) / 1000),
      }, 409);
    }

    const { error: updateError } = await supabase
      .from("notifications_boutiquiers")
      .update({
        statut: "accusee",
        acknowledged_at: new Date(nowMs).toISOString(),
        prochaine_tentative: null,
        last_error: null,
      })
      .eq("id", notification.id)
      .is("acknowledged_at", null);
    if (updateError) return response(req, { error: "Accusé impossible à enregistrer" }, 500);

    return response(req, {
      success: true,
      status: "accusee",
      message: "Commande marquée comme vue. Les relances sont arrêtées.",
    });
  } catch {
    return response(req, { error: "Requête invalide" }, 400);
  }
});
