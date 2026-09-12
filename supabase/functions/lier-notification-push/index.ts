import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  const headers = corsHeaders(req);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function safeString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validSubscription(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const subscription = value as Record<string, unknown>;
  const endpoint = subscription.endpoint;
  const keys = subscription.keys;
  return typeof endpoint === "string" && endpoint.startsWith("https://") && endpoint.length <= 2_000 &&
    !!keys && typeof keys === "object" && !Array.isArray(keys);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "Méthode non autorisée" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return jsonResponse(req, { error: "Configuration serveur incomplète" }, 500);

  try {
    const body = await req.json();
    const token = safeString(body?.token, 180);
    const subscription = body?.subscription;
    if (token.length < 32 || !validSubscription(subscription)) {
      return jsonResponse(req, { error: "Jeton ou abonnement invalide" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: notification, error: findError } = await supabase
      .from("notifications_boutiquiers")
      .select("id, telephone_boutique, acknowledged_at")
      .eq("ack_token", token)
      .is("acknowledged_at", null)
      .limit(1)
      .maybeSingle();
    if (findError) return jsonResponse(req, { error: "Activation impossible" }, 500);
    if (!notification) return jsonResponse(req, { error: "Lien d’activation expiré ou invalide" }, 404);

    const phone = safeString(notification.telephone_boutique, 24).replace(/\D/g, "").slice(-8);
    if (phone.length !== 8) return jsonResponse(req, { error: "Numéro boutique invalide" }, 409);

    const { error: insertError } = await supabase
      .from("abonnements_push")
      .insert({ subscription, telephone_boutique: phone });
    if (insertError) {
      const duplicate = /duplicate|unique/i.test(insertError.message);
      if (!duplicate) return jsonResponse(req, { error: "Abonnement impossible" }, 500);
    }

    return jsonResponse(req, { success: true, telephone_boutique: phone });
  } catch {
    return jsonResponse(req, { error: "Requête invalide" }, 400);
  }
});
