import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";
import { envoyerEmailCommande } from "./email-commande.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const DISCORD_WEBHOOK_ADMIN = Deno.env.get("DISCORD_WEBHOOK_ADMIN") || Deno.env.get("DISCORD_WEBHOOK_URL") || "";
const SITE_ORIGIN = "https://roimtrmt-stack.github.io/prime-service";
const SITE_PATH = SITE_ORIGIN;
const NOTIFICATION_LOGO_URL = `${SITE_PATH}/logo-prime-service.png`;
const ACK_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/accuser-notification`;
const MAX_BATCH = 100;
const RETRY_DELAY_MS = 3 * 60 * 1000;
const MAX_ATTEMPTS = 4;
const NOTIFICATION_GENERALE_DELAY_MS = 60 * 1000; // 1 minute pour les notifications générales
const ALLOWED_ORIGINS = new Set([
  "https://roimtrmt-stack.github.io",
  "https://primeservice.netlify.app",
  "http://localhost:4173",
  "http://localhost:5173",
]);

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails("mailto:roimtrmt@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

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

function clip(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function attemptTitle(attempt: number): string {
  if (attempt === 1) return "📦 Nouvelle commande Prime Service";
  if (attempt === 2) return "🔔 RAPPEL 1/3 — commande à confirmer";
  if (attempt === 3) return "⚠️ RAPPEL URGENT 2/3 — action requise";
  return "🚨 DERNIER RAPPEL 3/3 — réponse immédiate demandée";
}

function attemptBody(message: string, attempt: number): string {
  if (attempt === 1) return message;
  if (attempt === 2) return `${message}\n\nMerci d’ouvrir Prime Service et de confirmer que vous avez vu cette commande.`;
  if (attempt === 3) return `${message}\n\n⚠️ La commande attend votre confirmation. Préparez les articles maintenant et appuyez sur « J’AI VU ».`;
  return `${message}\n\n🚨 DERNIÈRE RELANCE : sans confirmation, le propriétaire vous appellera directement pour vous informer.`;
}

function ackUrl(token: string): string {
  return `${SITE_ORIGIN}/boutique-notification.html?token=${encodeURIComponent(token)}`;
}

async function sendPush(
  subscription: Record<string, unknown>,
  message: string,
  attempt: number,
  token: string,
  boutique: string,
  expiresAt: string,
): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error("Clés VAPID absentes");
  await webpush.sendNotification(
    subscription,
    JSON.stringify({
      title: attemptTitle(attempt),
      body: attemptBody(message, attempt),
      icon: `${SITE_ORIGIN}/icon-192.png`,
      badge: `${SITE_ORIGIN}/icon-192.png`,
      tag: `prime-service-${token}`,
      renotify: true,
      requireInteraction: attempt >= 2,
      vibrate: attempt >= 3 ? [300, 100, 300, 100, 600] : [200, 100, 200],
      data: {
        ackUrl: ackUrl(token),
        ackEndpoint: ACK_FUNCTION_URL,
        token,
        boutique: clip(boutique, 100),
        expiresAt,
      },
      actions: attempt >= 2
        ? [{ action: "ack", title: "🟥 J’AI VU LA COMMANDE" }]
        : [],
    }),
    {
      urgency: "high",
      headers: { "Urgency": "high" },
      TTL: 86400,
    }
  );
}

async function escalateDiscord(notification: Record<string, unknown>, attempt: number): Promise<void> {
  if (!DISCORD_WEBHOOK_ADMIN) return;
  const response = await fetch(DISCORD_WEBHOOK_ADMIN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: [
        "🚨 **BOUTIQUIER SANS RÉPONSE — ACTION MANUELLE REQUISE**",
        `🏪 Boutique : **${clip(notification.nom_boutique, 120)}**`,
        `📞 Numéro à appeler : **${clip(notification.telephone_boutique, 40)}**`,
        `🆔 Commande : **${clip(notification.commande_id, 80)}**`,
        `🔁 Dernière tentative envoyée : **${attempt}/${MAX_ATTEMPTS}**`,
        "📌 Merci d’appeler ce boutiquier pour l’informer manuellement de la commande.",
      ].join("\n"),
      allowed_mentions: { parse: [] },
    }),
  });
  if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
}

/* Repli automatique : quand aucun appareil de la boutique n'a reçu le push, la
   commande part par e-mail (photos des articles incluses). */
async function envoyerEmailDeSecours(
  supabase: ReturnType<typeof createClient>,
  notification: Record<string, unknown>,
): Promise<{ envoye: boolean; raison: string } | null> {
  const digits = String(notification.telephone_boutique || "").replace(/\D/g, "").slice(-8);
  if (digits.length !== 8) return null;

  const { data: preference } = await supabase
    .from("preferences_notification")
    .select("email_notification")
    .eq("telephone_boutique", digits)
    .maybeSingle();
  const destinataire = String(preference?.email_notification || "").trim();
  if (!destinataire) return null;

  const { data: commande } = await supabase
    .from("commandes")
    .select("articles, total, nom_client, telephone_client, quartier_client, precision_livraison, lat_client, lng_client")
    .eq("id", notification.commande_id)
    .maybeSingle();

  const lignes = (Array.isArray(commande?.articles) ? commande!.articles : []) as Array<Record<string, unknown>>;
  const articles = lignes.map((article, index) => ({
    id: Number.isFinite(Number(article?.id)) ? Number(article.id) : index,
    nom: String(article?.nom || "Article"),
    prix: Number(article?.prix) || 0,
    quantite: Number(article?.quantite) || 1,
    image_url: typeof article?.image_url === "string" ? article.image_url : null,
  }));

  const lat = Number(commande?.lat_client);
  const lng = Number(commande?.lng_client);
  const carte = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
    : null;

  const resultat = await envoyerEmailCommande({
    destinataire,
    boutique: String(notification.nom_boutique || "Boutique"),
    commandeId: String(notification.commande_id || ""),
    articles: articles.length > 0 ? articles : [{
      id: null,
      nom: String(notification.message || "Commande Prime Service").slice(0, 200),
      prix: Number(commande?.total) || 0,
      quantite: 1,
      image_url: null,
    }],
    montant: Number(commande?.total) || 0,
    client: String(commande?.nom_client || ""),
    telephone: String(commande?.telephone_client || ""),
    quartier: String(commande?.quartier_client || ""),
    precision: commande?.precision_livraison ? String(commande.precision_livraison) : null,
    mapUrl: carte,
    note: "Le site n'a pas pu joindre les appareils de votre boutique : voici la commande par e-mail.",
  });

  // Pas de trace console dans cette fonction (règle du projet) : le résultat
  // est renvoyé à l'appelant et la colonne email_envoye_le sert de témoin.
  return resultat ? { envoye: resultat.envoye, raison: resultat.raison } : null;
}

async function traiterNotification(
  supabase: ReturnType<typeof createClient>,
  notification: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const currentAttempt = Number(notification.tentative ?? 0);
  const attempt = currentAttempt + 1;
  const id = String(notification.id);
  const token = String(notification.ack_token || "");
  const message = clip(notification.message, 2_000);

  // Réserver la ligne pendant l’envoi pour éviter un double envoi si deux runs cron se chevauchent.
  const claimUntil = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("notifications_boutiquiers")
    .update({ prochaine_tentative: claimUntil, last_error: null })
    .eq("id", id)
    .eq("statut", "en_attente")
    .eq("tentative", currentAttempt)
    .is("acknowledged_at", null)
    .select("id, ack_token, message, nom_boutique, telephone_boutique, commande_id, tentative, acknowledged_at, created_at, email_envoye_le")
    .maybeSingle();
  if (claimError || !claimed) return { id, status: "already_claimed_or_acknowledged" };

  let subscriptions: Array<{ subscription: Record<string, unknown> }> = [];
  const { data: rows } = await supabase
    .from("abonnements_push")
    .select("subscription")
    .eq("telephone_boutique", notification.telephone_boutique)
    .limit(20);
  subscriptions = (rows || []) as Array<{ subscription: Record<string, unknown> }>;

  let delivered = 0;
  let lastError = "";
  for (const row of subscriptions) {
    try {
      await sendPush(
        row.subscription,
        message,
        attempt,
        token,
        String(notification.nom_boutique || "Boutique"),
        (() => {
          const createdAt = Date.parse(String(notification.created_at || ""));
          return new Date(Number.isFinite(createdAt) ? createdAt + 60 * 60 * 1000 : Date.now() + 60 * 60 * 1000).toISOString();
        })(),
      );
      delivered += 1;
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 240) : "échec push";
    }
  }

  // Aucun appareil joint : envoi de secours par e-mail, une seule fois.
  if (delivered === 0 && !notification.email_envoye_le) {
    const secours = await envoyerEmailDeSecours(supabase, notification);
    if (secours) {
      await supabase
        .from("notifications_boutiquiers")
        .update({ email_envoye_le: new Date().toISOString() })
        .eq("id", id);
    }
  }

  if (attempt >= MAX_ATTEMPTS) {
    const { data: stillPending } = await supabase
      .from("notifications_boutiquiers")
      .select("id, acknowledged_at")
      .eq("id", id)
      .is("acknowledged_at", null)
      .maybeSingle();
    if (stillPending) {
      await supabase
        .from("notifications_boutiquiers")
        .update({
          tentative: attempt,
          statut: "echec_definitif",
          prochaine_tentative: null,
          escalated_at: new Date().toISOString(),
          last_error: delivered > 0 ? null : (lastError || "aucun abonnement push actif"),
        })
        .eq("id", id)
        .is("acknowledged_at", null);
      await escalateDiscord(notification, attempt);
    }
    return { id, attempt, delivered, status: "escalated_or_acknowledged" };
  }

  await supabase
    .from("notifications_boutiquiers")
    .update({
      tentative: attempt,
      statut: "en_attente",
      prochaine_tentative: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
      last_error: delivered > 0 ? null : (lastError || "aucun abonnement push actif"),
    })
    .eq("id", id)
    .eq("tentative", currentAttempt)
    .is("acknowledged_at", null);

  return { id, attempt, delivered, status: "scheduled_next_attempt" };
}

async function traiterNotificationGenerale(
  supabase: ReturnType<typeof createClient>,
  notification: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = String(notification.id);
  const message = clip(notification.message, 2000);
  const titre = clip(notification.titre, 120) || "Prime Service";
  const url = clip(notification.url, 500);
  const currentAttempt = Number(notification.tentative ?? 0);

  const { data: abonnements } = await supabase
    .from("abonnements_push")
    .select("subscription")
    .limit(1000);

  const payload = JSON.stringify({
    title: titre,
    body: message,
    icon: NOTIFICATION_LOGO_URL,
    badge: NOTIFICATION_LOGO_URL,
    image: url || NOTIFICATION_LOGO_URL,
    tag: `prime-service-general-${Date.now()}`,
    renotify: true,
    requireInteraction: false,
    data: { url: url || SITE_PATH, image: url || NOTIFICATION_LOGO_URL },
  });

  let delivered = 0;
  let lastError = "";

  for (const abo of abonnements || []) {
    try {
      await webpush.sendNotification(abo.subscription, payload);
      delivered++;
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 240) : "échec push";
    }
  }

  await supabase
    .from("notifications_generales")
    .update({
      statut: delivered > 0 ? "envoyee" : "annulee",
      envoyee_at: delivered > 0 ? new Date().toISOString() : null,
      tentative: currentAttempt + 1,
      last_error: delivered > 0 ? null : lastError,
    })
    .eq("id", id)
    .eq("tentative", currentAttempt);

  return { id, delivered, status: delivered > 0 ? "sent" : "canceled" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "Méthode non autorisée" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return jsonResponse(req, { error: "Configuration serveur incomplète" }, 500);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date().toISOString();
  const { data: pending, error } = await supabase
    .from("notifications_boutiquiers")
    .select("id, commande_id, nom_boutique, telephone_boutique, message, statut, tentative, prochaine_tentative, ack_token, acknowledged_at, created_at")
    .eq("statut", "en_attente")
    .is("acknowledged_at", null)
    .lt("tentative", MAX_ATTEMPTS)
    .lte("prochaine_tentative", now)
    .order("prochaine_tentative", { ascending: true })
    .limit(MAX_BATCH);
  if (error) return jsonResponse(req, { error: error.message }, 500);

  const results = [];
  for (const notification of pending || []) {
    try {
      results.push(await traiterNotification(supabase, notification));
    } catch (error) {
      results.push({
        id: notification.id,
        status: "error",
        error: error instanceof Error ? error.message.slice(0, 240) : "erreur worker",
      });
    }
  }

  // Traiter les notifications générales
  const { data: generalPending, error: genError } = await supabase
    .from("notifications_generales")
    .select("id, message, titre, url, tentative, max_tentatives, prochaine_tentative, created_at")
    .eq("statut", "en_attente")
    .lt("tentative", 1)
    .lte("prochaine_tentative", now)
    .order("prochaine_tentative", { ascending: true })
    .limit(MAX_BATCH);
  if (genError) return jsonResponse(req, { error: genError.message }, 500);

  for (const notification of generalPending || []) {
    try {
      results.push(await traiterNotificationGenerale(supabase, notification));
    } catch (error) {
      results.push({
        id: notification.id,
        status: "error",
        error: error instanceof Error ? error.message.slice(0, 240) : "erreur worker",
      });
    }
  }

  return jsonResponse(req, { processed: results.length, results });
})
