import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "https://esm.sh/web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const DISCORD_WEBHOOK_ADMIN = Deno.env.get("DISCORD_WEBHOOK_ADMIN") || Deno.env.get("DISCORD_WEBHOOK_URL") || "";
const SITE_ORIGIN = "https://roimtrmt-stack.github.io/prime-service";
const ACK_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/accuser-notification`;
const MAX_BATCH = 100;
const RETRY_DELAY_MS = 3 * 60 * 1000;
const MAX_ATTEMPTS = 4;
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
      },
      actions: attempt >= 2
        ? [{ action: "ack", title: "🟥 J’AI VU LA COMMANDE" }]
        : [],
    }),
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
    .select("id, ack_token, message, nom_boutique, telephone_boutique, commande_id, tentative, acknowledged_at")
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
      );
      delivered += 1;
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 240) : "échec push";
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "Méthode non autorisée" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return jsonResponse(req, { error: "Configuration serveur incomplète" }, 500);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date().toISOString();
  const { data: pending, error } = await supabase
    .from("notifications_boutiquiers")
    .select("id, commande_id, nom_boutique, telephone_boutique, message, statut, tentative, prochaine_tentative, ack_token, acknowledged_at")
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

  console.log("[boutiquier-retries]", JSON.stringify({ now, processed: results.length, results }));
  return jsonResponse(req, { processed: results.length, results });
});
