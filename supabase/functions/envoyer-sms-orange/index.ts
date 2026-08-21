import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeMaliPhone, orangeSmsEnabled, sendOrangeSmsBatch } from "../_shared/orange-sms.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_EMAIL = (Deno.env.get("ADMIN_EMAIL") || "roimtrmt@gmail.com").toLowerCase();
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

function phonesFromArticles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((article) => article && typeof article === "object"
      ? normalizeMaliPhone((article as Record<string, unknown>).telephone_boutique)
      : null)
    .filter((phone): phone is string => Boolean(phone));
}

async function resolveRecipients(
  supabaseAdmin: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<{ phones: string[]; source: string }> {
  const commandId = text(body.commande_id, 100);
  if (commandId) {
    const { data, error } = await supabaseAdmin
      .from("commandes")
      .select("id, articles")
      .eq("id", commandId)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Commande introuvable");
    return { phones: phonesFromArticles(data?.articles), source: "commande" };
  }

  const target = text(body.cible, 30).toLowerCase() || "boutiques";
  if (target !== "boutiques") throw new Error("Cible SMS non autorisée");
  const { data, error } = await supabaseAdmin
    .from("produits")
    .select("telephone_boutique")
    .not("telephone_boutique", "is", null)
    .limit(1_000);
  if (error) throw new Error("Destinataires boutique indisponibles");
  const phones = (data || [])
    .map((row) => normalizeMaliPhone(row.telephone_boutique))
    .filter((phone): phone is string => Boolean(phone));
  return { phones, source: "boutiques" };
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
    const message = text(body.message, 2_000);
    if (!message) return jsonResponse(req, { error: "Message manquant" }, 400);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const recipients = await resolveRecipients(supabaseAdmin, body);
    const phones = [...new Set(recipients.phones)].slice(0, 100);
    if (!orangeSmsEnabled()) {
      return jsonResponse(req, {
        success: true,
        enabled: false,
        source: recipients.source,
        targets: phones.length,
        accepted: 0,
        reason: "ORANGE_SMS_ENABLED désactivé",
      });
    }

    const results = await sendOrangeSmsBatch(phones, message);
    const accepted = results.filter((result) => result.delivered).length;
    console.log("[orange-sms-manuel]", JSON.stringify({
      source: recipients.source,
      targets: phones.length,
      accepted,
      refused: results.length - accepted,
    }));
    return jsonResponse(req, {
      success: true,
      enabled: true,
      source: recipients.source,
      targets: phones.length,
      accepted,
      refused: results.length - accepted,
    });
  } catch (error) {
    console.error("[orange-sms-manuel] erreur", error instanceof Error ? error.message : error);
    return jsonResponse(req, { error: "Envoi SMS Orange impossible" }, 500);
  }
});
