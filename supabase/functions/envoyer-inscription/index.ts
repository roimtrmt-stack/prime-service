import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://roimtrmt-stack.github.io",
  "https://primeservice.netlify.app",
  "http://localhost:4173",
  "http://localhost:5173",
]);
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 5;
const MAX_BODY_BYTES = 25_000_000;
const MAX_FILES = 10;
const MAX_FILE_BYTES = 8_000_000;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const rateState = new Map<string, { started: number; count: number }>();

function corsHeaders(req: Request): Headers {
  const origin = req.headers.get("origin") || "";
  return new Headers({
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://roimtrmt-stack.github.io",
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

function rateLimited(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const key = forwarded.split(",")[0].trim() || "unknown";
  const now = Date.now();
  const current = rateState.get(key);
  if (!current || now - current.started >= WINDOW_MS) {
    rateState.set(key, { started: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS;
}

function validPushSubscription(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const subscription = value as Record<string, unknown>;
  const endpoint = subscription.endpoint;
  const keys = subscription.keys;
  return typeof endpoint === "string" && endpoint.startsWith("https://") && endpoint.length <= 2_000 &&
    !!keys && typeof keys === "object" && !Array.isArray(keys);
}

// Rattache l'abonnement push capturé à l'inscription au numéro de la boutique.
// Écrit uniquement via le rôle service (la RLS interdit ce geste au navigateur).
// Volontairement NON bloquant : le moindre problème (config absente, abonnement
// invalide, erreur base) ne fait échouer ni l'inscription ni l'envoi Discord —
// le lien d'activation du premier SMS de commande reste le filet de sécurité.
async function lierAbonnementPush(telephone: string, subscription: unknown): Promise<void> {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !validPushSubscription(subscription)) return;
    const digits = telephone.replace(/\D/g, "").replace(/^223/, "").slice(-8);
    if (digits.length !== 8) return;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error } = await supabase      .from("abonnements_push")      .insert({ subscription, telephone_boutique: digits });
    if (error && !/duplicate|unique/i.test(error.message)) {
      console.warn("Rattachement push inscription non fatal :", error.message.slice(0, 200));
    }
  } catch (error) {
    console.warn("Rattachement push inscription non fatal :", error instanceof Error ? error.message.slice(0, 200) : "inconnu");
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "Méthode non autorisée" }, 405);
  if (rateLimited(req)) return jsonResponse(req, { error: "Trop de demandes, réessayez plus tard" }, 429);

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return jsonResponse(req, { error: "Requête trop volumineuse" }, 413);
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data;")) {
    return jsonResponse(req, { error: "Format multipart requis" }, 400);
  }

  try {
    const formData = await req.formData();
    const rawPayload = formData.get("payload_json");
    if (typeof rawPayload !== "string") return jsonResponse(req, { error: "Métadonnées manquantes" }, 400);
    const payload = JSON.parse(rawPayload) as { content?: unknown; embeds?: unknown };
    const content = text(payload.content, 4_000);
    const embeds = Array.isArray(payload.embeds) ? payload.embeds.slice(0, MAX_FILES) : [];
    if (!content || embeds.length === 0) return jsonResponse(req, { error: "Inscription invalide" }, 400);

    const files: Array<{ name: string; file: File }> = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("file") || !(value instanceof File)) continue;
      if (value.size > MAX_FILE_BYTES) return jsonResponse(req, { error: "Photo trop volumineuse" }, 413);
      files.push({ name: key, file: value });
    }
    if (files.length === 0 || files.length > MAX_FILES) return jsonResponse(req, { error: "Nombre de photos invalide" }, 400);

    // Abonnement push capturé à l'inscription (peut être absent : case jamais
    // activée, navigateur non compatible, ou ancienne version de la page). S'il
    // est présent, on le rattache au numéro de la boutique sans jamais bloquer.
    const pushSubscriptionBrute = formData.get("push_subscription");
    const telephoneBoutique = text(formData.get("telephone_boutique"), 24);
    let pushSubscription: Record<string, unknown> | null = null;
    if (typeof pushSubscriptionBrute === "string" && pushSubscriptionBrute.length <= 4_000) {
      try {
        const parsed = JSON.parse(pushSubscriptionBrute);
        if (validPushSubscription(parsed)) pushSubscription = parsed;
      } catch {
        // JSON invalide : on ignore simplement l'abonnement.
      }
    }
    const lierPush = pushSubscription && telephoneBoutique
      ? lierAbonnementPush(telephoneBoutique, pushSubscription)
      : Promise.resolve();

    // Ce webhook est réservé au propriétaire. Aucun numéro de boutique n’est lu ou transmis ici.
    const ownerWebhook = Deno.env.get("DISCORD_WEBHOOK_INSCRIPTION");
    if (!ownerWebhook) return jsonResponse(req, { error: "Configuration serveur incomplète" }, 500);

    const firstResponse = await fetchWithTimeout(ownerWebhook, {
      method: "POST",
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      headers: { "Content-Type": "application/json" },
    });
    if (!firstResponse.ok) return jsonResponse(req, { error: "Échec de réception de l’inscription" }, 502);

    // Envoi séquentiel volontaire : le délai augmente avec le nombre de photos, sans bloquer les commandes.
    for (let i = 0; i < Math.min(embeds.length, files.length); i += 1) {
      const file = files.find((item) => item.name === `file${i}`);
      if (!file) continue;
      const title = text((embeds[i] as Record<string, unknown>)?.title, 160) || "Article";
      const formArticle = new FormData();
      formArticle.append("payload_json", JSON.stringify({
        content: `**${title}**`,
        embeds: [{ image: { url: "attachment://file0" }, color: 0x2563eb }],
        allowed_mentions: { parse: [] },
      }));
      formArticle.append("file0", file.file, file.file.name.slice(0, 120));
      const response = await fetchWithTimeout(ownerWebhook, { method: "POST", body: formArticle }, 20_000);
      if (!response.ok) return jsonResponse(req, { error: "Échec d’envoi d’une photo" }, 502);
    }

    // Après le succès Discord : on attend le rattachement push (déjà en cours,
    // non bloquant et borné par les garde-fous internes de lierAbonnementPush).
    await lierPush;

    return jsonResponse(req, { success: true, recipient: "owner" });
  } catch (error) {
    console.error("Erreur dans envoyer-inscription", error);
    return jsonResponse(req, { error: "Requête impossible à traiter" }, 500);
  }
});
