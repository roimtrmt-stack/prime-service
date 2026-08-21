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

function response(req: Request, body: unknown, status = 200): Response {
  const headers = corsHeaders(req);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function safeText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return response(req, { error: "Méthode non autorisée" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return response(req, { error: "Configuration serveur incomplète" }, 500);

  try {
    const body = await req.json();
    const token = safeText(body?.token, 180);
    if (token.length < 32) return response(req, { error: "Jeton d’accusé invalide" }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: notification, error: findError } = await supabase
      .from("notifications_boutiquiers")
      .select("id, nom_boutique, telephone_boutique, commande_id, acknowledged_at")
      .eq("ack_token", token)
      .limit(1)
      .maybeSingle();
    if (findError) return response(req, { error: "Recherche impossible" }, 500);
    if (!notification) return response(req, { error: "Notification introuvable ou lien expiré" }, 404);

    if (!notification.acknowledged_at) {
      const { error: updateError } = await supabase
        .from("notifications_boutiquiers")
        .update({
          statut: "accusee",
          acknowledged_at: new Date().toISOString(),
          prochaine_tentative: null,
          last_error: null,
        })
        .eq("id", notification.id)
        .is("acknowledged_at", null);
      if (updateError) return response(req, { error: "Accusé impossible à enregistrer" }, 500);
    }

    return response(req, {
      success: true,
      status: "accusee",
      message: "Commande marquée comme vue. Les relances sont arrêtées.",
    });
  } catch {
    return response(req, { error: "Requête invalide" }, 400);
  }
});
