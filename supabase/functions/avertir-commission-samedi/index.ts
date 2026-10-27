import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const SITE_ORIGIN = "https://roimtrmt-stack.github.io/prime-service";
const NOTIFICATION_LOGO_URL = `${SITE_ORIGIN}/logo-prime-service.png`;
const ADMIN_EMAIL = (Deno.env.get("ADMIN_EMAIL") || "roimtrmt@gmail.com").toLowerCase();
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const MAX_SUBSCRIPTIONS = 1000;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails("mailto:roimtrmt@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

function corsHeaders(req: Request): Headers {
  const origin = req.headers.get("origin") || "";
  return new Headers({
    "Access-Control-Allow-Origin":
      origin === "https://primeservice.netlify.app" ? origin : SITE_ORIGIN.slice(0, SITE_ORIGIN.length - "/prime-service".length),
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
    const message = text(body?.message, 500);
    if (!message) return jsonResponse(req, { error: "Message manquant" }, 400);
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return jsonResponse(req, { error: "Configuration VAPID serveur incomplète" }, 500);
    }

    // Cible optionnelle : si un numéro de boutique est fourni, on avertit
    // UNIQUEMENT cette boutique (rappel de commission personnalisé). Sinon,
    // on avertit tous les boutiquiers comme avant.
    const cibleDemandee = normaliserTelephone(body?.telephone_boutique || "");

    // Sélection côté serveur : UNIQUEMENT les abonnements liés à un numéro de
    // boutique (les navigaleurs des clients ont telephone_boutique = null et
    // sont de toute façon exclus ici). Aucune liste de numéros ne passe par
    // le navigateur.
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
    const { data: abonnements, error: lectureError } = await supabaseAdmin
      .from("abonnements_push")
      .select("id,subscription,telephone_boutique")
      .not("telephone_boutique", "is", null)
      .limit(MAX_SUBSCRIPTIONS);
    if (lectureError) throw lectureError;

    // Une même boutique peut avoir plusieurs navigateurs (2 téléphones...) :
    // on essaie TOUS ses navigateurs, car un abonnement peut être mort (téléphone
    // changé, cache vidé) même si un autre récent existe. Le filtrage se fait en
    // JS après normalisation des numéros (tolérant aux formats « +223… » /
    // « 00223… » / « 94134408 » stockés dans la base).
    const selection = (abonnements || []).filter((ligne) => {
      const numero = normaliserTelephone(ligne.telephone_boutique);
      if (!numero) return false;
      if (cibleDemandee && numero !== cibleDemandee) return false;
      return true;
    });

    const payload = JSON.stringify({
      title: "💰 Prise de commission — Samedi",
      body: message,
      icon: NOTIFICATION_LOGO_URL,
      badge: NOTIFICATION_LOGO_URL,
      image: NOTIFICATION_LOGO_URL,
      tag: `prime-service-commission-samedi-${Date.now()}`,
      renotify: false,
      requireInteraction: false,
      data: { url: SITE_ORIGIN, image: NOTIFICATION_LOGO_URL },
    });

    const essais = await Promise.all(selection.map(async (ligne) => {
      try {
        await webpush.sendNotification(ligne.subscription, payload);
        return { ligne, ok: true as const, statut: null as number | null, raison: null as string | null };
      } catch (erreur) {
        const statut = (erreur as { statusCode?: number } | null)?.statusCode ?? null;
        const raison = erreur instanceof Error ? erreur.message.slice(0, 180) : "exception push";
        return { ligne, ok: false as const, statut, raison };
      }
    }));

    // Un numéro de boutique est considéré livré dès qu'UN de ses navigateurs
    // a reçu le push.
    const livraisonParNumero = new Map<string, boolean>();
    for (const essai of essais) {
      const numero = normaliserTelephone(essai.ligne.telephone_boutique);
      if (livraisonParNumero.get(numero) === true) continue;
      livraisonParNumero.set(numero, essai.ok);
    }

    // Abonnements morts (410 Gone / 404) : on les purge pour que l'envoi
    // suivant n'essaie plus les navigateurs définitivement disparus.
    const abonnementsMorts = essais
      .filter((essai) => !essai.ok && (essai.statut === 410 || essai.statut === 404))
      .map((essai) => essai.ligne.id);
    if (abonnementsMorts.length > 0) {
      const { error: errorPurge } = await supabaseAdmin.from("abonnements_push").delete().in("id", abonnementsMorts);
      if (errorPurge) console.error("[avertir-commission] purge abonnements morts impossible", errorPurge.message);
    }

    const envoyes = [...livraisonParNumero.values()].filter((livree) => livree).length;
    const echecsDetail = essais
      .filter((essai) => !essai.ok)
      .slice(0, 10)
      .map((essai) => ({ numero: normaliserTelephone(essai.ligne.telephone_boutique), statut: essai.statut, raison: essai.raison }));
    return jsonResponse(req, {
      success: true,
      envoyes,
      echecs: essais.filter((essai) => !essai.ok).length,
      boutiquiers_selectionnes: livraisonParNumero.size,
      echecs_detail: echecsDetail,
      abonnements_purges: abonnementsMorts.length,
      total_abonnements: selection.length,
      fournisseur: "web-push-vapid",
    });
  } catch (error) {
    console.error("Erreur dans avertir-commission-samedi:", error);
    return jsonResponse(req, { error: "Requête impossible à traiter" }, 500);
  }
});
