import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function validPath(value: unknown): string {
  const path = typeof value === "string" ? value.trim() : "/";
  if (!path || path.length > 200 || !path.startsWith("/")) return "/";
  return path.replace(/[\u0000-\u001f\u007f]/g, "");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const body = await request.json();
    const visitorId = typeof body?.visitor_id === "string" ? body.visitor_id.trim() : "";
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(visitorId)) {
      return json({ error: "Identifiant de visite invalide" }, 400);
    }

    const now = new Date();
    const visitDay = now.toISOString().slice(0, 10);
    const path = validPath(body?.path);
    const secret = Deno.env.get("VISIT_HASH_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!secret || !supabaseUrl || !serviceRoleKey) {
      console.error("Configuration de mesure incomplète");
      return json({ error: "Mesure temporairement indisponible" }, 503);
    }

    const visitorHash = await hmacHex(secret, `${visitDay}:${visitorId}`);
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await supabase.from("site_visites").insert({
      visit_day: visitDay,
      visitor_hash: visitorHash,
      path,
    });
    if (error) {
      console.error("Échec d’enregistrement de visite", error.message);
      return json({ error: "Mesure temporairement indisponible" }, 503);
    }

    return json({ ok: true });
  } catch (error) {
    console.error("Requête de visite invalide", error instanceof Error ? error.message : "unknown");
    return json({ error: "Requête invalide" }, 400);
  }
});
