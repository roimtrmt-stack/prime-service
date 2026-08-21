import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeMaliPhone } from "../_shared/orange-sms.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_EMAIL = (Deno.env.get("ADMIN_EMAIL") || "roimtrmt@gmail.com").toLowerCase();
const SITE_ORIGIN = "https://roimtrmt-stack.github.io/prime-service";
const ALLOWED_ORIGINS = new Set([
  "https://roimtrmt-stack.github.io",
  "https://primeservice.netlify.app",
  "http://localhost:4173",
  "http://localhost:5173",
]);

function corsHeaders(req: Request): Headers {
  const origin = req.headers.get("origin") || "";
  return new Headers({
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://roimtrmt-stack.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

function createAckToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function boutiquePhone(value: unknown): string | null {
  const normalized = normalizeMaliPhone(value);
  return normalized ? normalized.slice(-8) : null;
}

function amount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function requireAdmin(req: Request): Promise<Response | null> {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return jsonResponse(req, { error: "Authentification administrateur requise" }, 401);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || data.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return jsonResponse(req, { error: "Accès administrateur refusé" }, 403);
  }
  return null;
}

async function startRetryWorker(): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/notifier-boutiquier`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: "{}",
    });
  } catch (error) {
    console.error("[manual-notification] worker différé", error instanceof Error ? error.message : error);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "Méthode non autorisée" }, 405);
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(req, { error: "Configuration serveur incomplète" }, 500);
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    const commandeId = text(body.commande_id, 120);
    if (!commandeId) return jsonResponse(req, { error: "Commande manquante" }, 400);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: command, error: commandError } = await supabaseAdmin
      .from("commandes")
      .select("id, nom_client, telephone_client, lat_client, lng_client, articles")
      .eq("id", commandeId)
      .limit(1)
      .maybeSingle();
    if (commandError || !command) return jsonResponse(req, { error: "Commande introuvable" }, 404);

    const grouped = new Map<string, {
      phone: string;
      name: string;
      items: Array<{ name: string; quantity: number; net: number }>;
      address: string;
      net: number;
    }>();
    const articles = Array.isArray(command.articles) ? command.articles : [];
    for (const article of articles) {
      if (!article || typeof article !== "object") continue;
      const item = article as Record<string, unknown>;
      const phone = boutiquePhone(item.telephone_boutique);
      if (!phone) continue;
      const quantity = Math.max(1, Math.min(99, Math.round(amount(item.quantite) || 1)));
      const netPerItem = Math.max(0, amount(item.prix) - amount(item.commission));
      const shop = grouped.get(phone) || {
        phone,
        name: text(item.nom_boutique, 120) || "Boutique",
        items: [],
        address: text(item.adresse, 240) || "Non renseignée",
        net: 0,
      };
      shop.items.push({
        name: text(item.nom, 100) || "Article",
        quantity,
        net: netPerItem * quantity,
      });
      if (shop.address === "Non renseignée" && text(item.adresse, 240)) {
        shop.address = text(item.adresse, 240);
      }
      shop.net += netPerItem * quantity;
      grouped.set(phone, shop);
    }

    const rows = [...grouped.values()].map((shop) => {
      const ackToken = createAckToken();
      const activationUrl = `${SITE_ORIGIN}/?boutique_token=${encodeURIComponent(ackToken)}`;
      const mapUrl = Number.isFinite(Number(command.lat_client)) && Number.isFinite(Number(command.lng_client))
        ? `https://www.google.com/maps?q=${encodeURIComponent(String(command.lat_client))},${encodeURIComponent(String(command.lng_client))}`
        : "Carte non disponible";
      const message = [
        `Prime Service — commande #${String(command.id).slice(-8)}`,
        `Boutique : ${shop.name}`,
        `Adresse boutique : ${shop.address}`,
        "Articles à préparer :",
        ...shop.items.map((item) => `• ${item.name} x${item.quantity}`),
        `Montant NET à recevoir : ${Math.round(shop.net).toLocaleString("fr-FR")} FCFA`,
        `Client : ${text(command.nom_client, 60) || "—"} — ${text(command.telephone_client, 24) || "—"}`,
        `Carte client : ${mapUrl}`,
        `Activer les relances du site : ${activationUrl}`,
      ].join("\n");
      return {
        commande_id: String(command.id),
        nom_boutique: shop.name,
        telephone_boutique: shop.phone,
        message,
        statut: "en_attente",
        tentative: 0,
        prochaine_tentative: new Date().toISOString(),
        ack_token: ackToken,
      };
    });

    if (rows.length === 0) return jsonResponse(req, { error: "Aucun numéro boutique dans cette commande" }, 409);
    const { error: insertError } = await supabaseAdmin.from("notifications_boutiquiers").insert(rows);
    if (insertError) throw new Error("File de notification impossible");

    await startRetryWorker();
    console.log("[manual-notification] file créée", JSON.stringify({ commandeId: command.id, boutiques: rows.length }));
    return jsonResponse(req, { success: true, queued: rows.length, mode: "relances-push" }, 201);
  } catch (error) {
    console.error("[manual-notification] erreur", error instanceof Error ? error.message : error);
    return jsonResponse(req, { error: "Notification manuelle impossible" }, 500);
  }
});
