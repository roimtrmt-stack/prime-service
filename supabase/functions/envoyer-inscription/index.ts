const ALLOWED_ORIGINS = new Set([
  "https://roimtrmt-stack.github.io",
  "https://primeservice.netlify.app",
  "http://localhost:4173",
  "http://localhost:5173",
]);
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 5;
const MAX_BODY_BYTES = 25_000_000;
const MAX_FILES = 10;
const MAX_FILE_BYTES = 8_000_000;
const rateState = new Map<string, { started: number; count: number }>();

function corsHeaders(req: Request): Headers {
  const origin = req.headers.get("origin") || "";
  return new Headers({
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://roimtrmt-stack.github.io",
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

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function rateLimited(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const key = forwarded.split(",")[0].trim() || "unknown";
  const now = Date.now();
  const current = rateState.get(key);
  if (!current || now - current.started >= WINDOW_MS) {
    rateState.set(key, { started: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "Méthode non autorisée" }, 405);
  if (rateLimited(req)) return jsonResponse(req, { error: "Trop de demandes, réessayez plus tard" }, 429);

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return jsonResponse(req, { error: "Requête trop volumineuse" }, 413);
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("multipart/form-data;")) {
    return jsonResponse(req, { error: "Format multipart requis" }, 400);
  }

  try {
    const formData = await req.formData();
    const rawPayload = formData.get("payload_json");
    if (typeof rawPayload !== "string") return jsonResponse(req, { error: "Métadonnées manquantes" }, 400);
    const payload = JSON.parse(rawPayload) as { content?: unknown; embeds?: unknown };
    const content = text(payload.content, 4_000);
    const embeds = Array.isArray(payload.embeds) ? payload.embeds.slice(0, MAX_FILES) : [];
    if (!content || embeds.length === 0) return jsonResponse(req, { error: "Inscription invalide" }, 400);

    const files: Array<{ name: string; file: File }> = [];
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("file") || !(value instanceof File)) continue;
      if (value.size > MAX_FILE_BYTES) return jsonResponse(req, { error: "Photo trop volumineuse" }, 413);
      files.push({ name: key, file: value });
    }
    if (files.length === 0 || files.length > MAX_FILES) return jsonResponse(req, { error: "Nombre de photos invalide" }, 400);

    // Ce webhook est réservé au propriétaire. Aucun numéro de boutique n’est lu ou transmis ici.
    const ownerWebhook = Deno.env.get("DISCORD_WEBHOOK_INSCRIPTION");
    if (!ownerWebhook) return jsonResponse(req, { error: "Configuration serveur incomplète" }, 500);

    const firstResponse = await fetchWithTimeout(ownerWebhook, {
      method: "POST",
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      headers: { "Content-Type": "application/json" },
    });
    if (!firstResponse.ok) return jsonResponse(req, { error: "Échec de réception de l’inscription" }, 502);

    // Envoi séquentiel volontaire : le délai augmente avec le nombre de photos, sans bloquer les commandes.
    for (let i = 0; i < Math.min(embeds.length, files.length); i += 1) {
      const file = files.find((item) => item.name === `file${i}`);
      if (!file) continue;
      const title = text((embeds[i] as Record<string, unknown>)?.title, 160) || "Article";
      const formArticle = new FormData();
      formArticle.append("payload_json", JSON.stringify({
        content: `**${title}**`,
        embeds: [{ image: { url: "attachment://file0" }, color: 0x2563eb }],
        allowed_mentions: { parse: [] },
      }));
      formArticle.append("file0", file.file, file.file.name.slice(0, 120));
      const response = await fetchWithTimeout(ownerWebhook, { method: "POST", body: formArticle }, 20_000);
      if (!response.ok) return jsonResponse(req, { error: "Échec d’envoi d’une photo" }, 502);
    }

    return jsonResponse(req, { success: true, recipient: "owner" });
  } catch (error) {
    console.error("Erreur dans envoyer-inscription", error);
    return jsonResponse(req, { error: "Requête impossible à traiter" }, 500);
  }
});
