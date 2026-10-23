import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Fonction diagnostique : teste les webhooks Discord sans créer de commande
// (aucun insert en base, aucun SMS). Elle lit les secrets du projet côté serveur.
// Lancée depuis l'espace vendeur avec un token admin, ou côté outil d'exploitation
// avec le secret DIAG_TEST_KEY défini dans Supabase → Edge Functions → Secrets.
const ADMIN_EMAIL = (Deno.env.get("ADMIN_EMAIL") || "roimtrmt@gmail.com").toLowerCase();

function cors(req: Request): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-key-diag",
    "Vary": "Origin",
  });
}

function rep(req: Request, body: unknown, status = 200): Response {
  const h = cors(req);
  h.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: h });
}

async function requireAdmin(req: Request): Promise<Response | null> {
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const diag = Deno.env.get("DIAG_TEST_KEY") || "";
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const apikey = (req.headers.get("apikey") || "").trim();
  const keyDiag = (req.headers.get("x-key-diag") || "").trim();
  if (!token && !apikey && !keyDiag) return rep(req, { error: "Authentification administrateur requise" }, 401);
  // Accès serveur à serveur : la clé service_role est elle-même un secret.
  if ((token && token === serviceRole) || (apikey && apikey === serviceRole)) return null;
  if ((keyDiag && keyDiag === diag) || (token && token === diag)) return null;
  const supabase = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_ANON_KEY") || "");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || data.user?.email?.toLowerCase() !== ADMIN_EMAIL) return rep(req, { error: "Accès administrateur refusé" }, 403);
  return null;
}

async function sonder(url: string | undefined, nom: string): Promise<{ cible: string; present: boolean; http: number | null }> {
  if (!url) return { cible: nom, present: false, http: null };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Prime Service",
        content: `🧪 Test de connexion ${nom} — ${new Date().toISOString()}`,
      }),
    });
    return { cible: nom, present: true, http: r.status };
  } catch {
    return { cible: nom, present: true, http: null };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return rep(req, { error: "Méthode non autorisée" }, 405);
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const [commandes, inscriptions, escalade] = await Promise.all([
    sonder(Deno.env.get("DISCORD_WEBHOOK_URL"), "commandes (DISCORD_WEBHOOK_URL)"),
    sonder(Deno.env.get("DISCORD_WEBHOOK_INSCRIPTION"), "inscriptions (DISCORD_WEBHOOK_INSCRIPTION)"),
    sonder(Deno.env.get("DISCORD_WEBHOOK_ADMIN"), "escalade (DISCORD_WEBHOOK_ADMIN)"),
  ]);
  const ok = [commandes, inscriptions, escalade].some((r) => r.present && r.http !== null && r.http >= 200 && r.http <= 299);
  return rep(req, { success: ok, resultats: [commandes, inscriptions, escalade] });
});
