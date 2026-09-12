import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const SITE_ORIGINS = new Set([
  "https://primeservice.netlify.app",
  "https://roimtrmt-stack.github.io",
]);
const DEFAULT_SITE_ORIGIN = "https://roimtrmt-stack.github.io";
const SITE_PATH = `${DEFAULT_SITE_ORIGIN}/prime-service`;
const NOTIFICATION_LOGO_URL = `${SITE_PATH}/logo-prime-service.png`;
const ADMIN_EMAIL = (Deno.env.get("ADMIN_EMAIL") || "roimtrmt@gmail.com").toLowerCase();
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const MAX_SUBSCRIPTIONS = 1000;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails("mailto:roimtrmt@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

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
function normaliserTelephone(value: unknown): string {
  const chiffres = text(value, 40).replace(/\D/g, "");
  return chiffres.replace(/^00223/, "").replace(/^223/, "").slice(-8);
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
    if (url && !url.startsWith(`${DEFAULT_SITE_ORIGIN}/`) && !url.startsWith("https://primeservice.netlify.app/")) {
      return jsonResponse(req, { error: "URL non autorisée" }, 400);
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return jsonResponse(req, { error: "Configuration VAPID serveur incomplète" }, 500);
    const telephonesCibles = Array.isArray(body?.telephones_cibles)
      ? body.telephones_cibles.map(normaliserTelephone).filter(Boolean).slice(0, 100)
      : [];
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
    const { data: abonnements, error: lectureError } = await supabaseAdmin
      .from("abonnements_push")
      .select("id,subscription,telephone_boutique")
      .limit(MAX_SUBSCRIPTIONS);
    if (lectureError) throw lectureError;
    const selection = (abonnements || []).filter((ligne) => !telephonesCibles.length || telephonesCibles.includes(normaliserTelephone(ligne.telephone_boutique)));
    const payload = JSON.stringify({
      title: titre,
      body: message,
      icon: NOTIFICATION_LOGO_URL,
      badge: NOTIFICATION_LOGO_URL,
      image: NOTIFICATION_LOGO_URL,
      tag: `prime-service-general-${Date.now()}`,
      renotify: true,
      requireInteraction: false,
      data: { url: url || `${SITE_PATH}/`, image: NOTIFICATION_LOGO_URL },
    });
    const resultats = await Promise.allSettled(selection.map((ligne) => webpush.sendNotification(ligne.subscription, payload)));
    const envoyes = resultats.filter((resultat) => resultat.status === "fulfilled").length;
    const echecs = resultats.length - envoyes;
    return jsonResponse(req, { success: true, envoyes, echecs, abonnes_selectionnes: selection.length, fournisseur: "web-push-vapid" });
  } catch (error) {
    console.error("Erreur dans clever-processor:", error);
    return jsonResponse(req, { error: "Requête impossible à traiter" }, 500);
  }
});
