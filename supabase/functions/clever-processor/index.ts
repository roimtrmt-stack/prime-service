import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_ORIGINS = new Set([
  "https://primeservice.netlify.app",
  "https://roimtrmt-stack.github.io",
]);
const DEFAULT_SITE_ORIGIN = "https://primeservice.netlify.app";
const ADMIN_EMAIL = (Deno.env.get("ADMIN_EMAIL") || "roimtrmt@gmail.com").toLowerCase();

function corsHeaders(req: Request): Headers {
  const origin = req.headers.get("origin") || "";
  return new Headers({
    "Access-Control-Allow-Origin": SITE_ORIGINS.has(origin) ? origin : DEFAULT_SITE_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  });
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  const headers = corsHeaders(req);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function requireAdmin(req: Request): Promise<Response | null> {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return jsonResponse(req, { error: "Authentification administrateur requise" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_ANON_KEY") || "");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || data.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return jsonResponse(req, { error: "Accès administrateur refusé" }, 403);
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "Méthode non autorisée" }, 405);
  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const message = text(body?.message, 2000);
    const titre = text(body?.titre, 120) || "Prime Service";
    const url = text(body?.url, 500);
    if (!message) return jsonResponse(req, { error: "Message manquant" }, 400);
    if (url && !url.startsWith(`${DEFAULT_SITE_ORIGIN}/`) && !url.startsWith("https://roimtrmt-stack.github.io/")) {
      return jsonResponse(req, { error: "URL non autorisée" }, 400);
    }

    const telephones = Array.isArray(body?.telephones_cibles)
      ? body.telephones_cibles.map((value: unknown) => text(value, 40)).filter(Boolean).slice(0, 100)
      : null;
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
    const { count: nbEnvoyes, error: countError } = await supabaseAdmin.from("abonnements_push").select("id", { count: "exact", head: true });
    if (countError) console.error("Erreur comptage abonnés:", countError);

    const appId = Deno.env.get("ONE_SIGNAL_APP_ID");
    const restKey = Deno.env.get("ONE_SIGNAL_REST_KEY");
    if (!appId || !restKey) return jsonResponse(req, { error: "Configuration serveur incomplète" }, 500);

    const payload: Record<string, unknown> = {
      app_id: appId,
      headings: { fr: titre },
      contents: { fr: message },
      data: { url: url || `${DEFAULT_SITE_ORIGIN}/` },
    };
    if (telephones && telephones.length > 0) payload.include_external_user_ids = telephones;
    else payload.included_segments = ["All"];

    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Key ${restKey}` },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return jsonResponse(req, { error: "Échec de l’envoi de la notification" }, 502);
    return jsonResponse(req, { success: true, envoyes: nbEnvoyes || 0 });
  } catch (error) {
    console.error("Erreur dans clever-processor:", error);
    return jsonResponse(req, { error: "Requête impossible à traiter" }, 500);
  }
});
