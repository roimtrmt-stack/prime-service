const PROJECT_REF = "kfxalpvbtbvkncztjwzc";
const ALLOWED_ORIGIN = "https://roimtrmt-stack.github.io";
const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: corsHeaders });
}

function isAllowedImageUrl(value: unknown): value is string {
  if(typeof value !== "string" || value.length < 20 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === `${PROJECT_REF}.supabase.co`
      && url.username === ""
      && url.password === ""
      && url.pathname.startsWith("/storage/v1/object/public/photos-articles/");
  } catch {
    return false;
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for(let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

async function fetchImageAsBase64(imageUrl: string, signal: AbortSignal) {
  const imageResponse = await fetch(imageUrl, { method: "GET", redirect: "error", signal });
  if(!imageResponse.ok) throw new Error("image_fetch_failed");
  if(Number(imageResponse.headers.get("content-length") || 0) > MAX_IMAGE_BYTES) throw new Error("image_too_large");
  const mimeType = (imageResponse.headers.get("content-type") || "image/jpeg").split(";")[0].toLowerCase();
  if(!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType)) throw new Error("image_type_not_allowed");
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  if(bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error("image_too_large");
  return { base64: bytesToBase64(bytes), mimeType };
}

function cleanModelName(value: unknown) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function clampConfidence(value: unknown) {
  const number = Number(value);
  if(!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function extractResponseText(payload: any) {
  const result = payload?.result;
  if(typeof result === "string") return result.trim();
  if(typeof result?.response === "string") return result.response.trim();
  if(typeof result?.text === "string") return result.text.trim();
  if(typeof payload?.response === "string") return payload.response.trim();
  return "";
}

function parseResult(text: string) {
  const cleaned = String(text || "").replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if(start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fallback below */ }
  }
  const firstLine = cleaned.split(/[.!?\n]/)[0]?.trim();
  if(firstLine && firstLine.split(/\s+/).length <= 8) return { nom: firstLine, confiance: 0.55 };
  return null;
}

Deno.serve(async (request) => {
  if(request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if(request.method !== "POST") return jsonResponse({ ok: false, code: "method_not_allowed" }, 405);
  if(request.headers.get("origin") !== ALLOWED_ORIGIN) return jsonResponse({ ok: false, code: "origin_not_allowed" }, 403);

  let body: any;
  try { body = await request.json(); } catch { return jsonResponse({ ok: false, code: "invalid_json" }, 400); }
  if(!isAllowedImageUrl(body?.imageUrl)) return jsonResponse({ ok: false, code: "invalid_image_url" }, 400);

  const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID")?.trim();
  const apiToken = Deno.env.get("CLOUDFLARE_API_TOKEN")?.trim();
  if(!accountId || !apiToken) return jsonResponse({ ok: false, configured: false, code: "cloudflare_not_configured" }, 503);
  const model = (Deno.env.get("CLOUDFLARE_AI_MODEL") || DEFAULT_MODEL).trim();
  if(!/^@cf\/[a-zA-Z0-9._/-]+$/.test(model)) return jsonResponse({ ok: false, configured: true, code: "cloudflare_model_invalid" }, 503);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const image = await fetchImageAsBase64(body.imageUrl, controller.signal);
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`;
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        image: image.base64,
        prompt: "Analyse uniquement ce qui est réellement visible sur cette photo d’article. Donne un nom commercial très court et élégant de 2 à 5 mots, en français, mettant en valeur l’aspect visible le plus fort : couleur, forme, finition ou style. N’invente aucune marque, taille ou matière invisible. Réponds avec un objet JSON strict : {\"nom\": \"...\", \"confiance\": 0.0}.",
      }),
    });

    if(!response.ok) {
      let providerCode = "";
      try {
        const errorPayload = await response.clone().json();
        providerCode = String(errorPayload?.errors?.[0]?.code || errorPayload?.errors?.[0]?.message || "")
          .replace(/[^a-zA-Z0-9_.-]/g, "")
          .slice(0, 64);
      } catch { /* code HTTP only */ }
      const code = providerCode === "5016"
        ? "cloudflare_model_agreement_required"
        : providerCode === "3023"
          ? "cloudflare_account_blocked"
          : response.status === 401 || response.status === 403
            ? "cloudflare_key_rejected"
        : response.status === 404
          ? "cloudflare_model_unavailable"
          : response.status === 400
            ? "cloudflare_request_rejected"
            : response.status === 429
              ? "cloudflare_quota_or_rate_limit"
              : "cloudflare_unavailable";
      return jsonResponse({ ok: false, configured: true, code, provider_code: providerCode || undefined }, 502);
    }

    const payload = await response.json();
    if(payload?.success === false) return jsonResponse({ ok: false, configured: true, code: "cloudflare_invalid_output" }, 502);
    const result = parseResult(extractResponseText(payload));
    if(!result) return jsonResponse({ ok: false, configured: true, code: "cloudflare_invalid_output" }, 502);
    const nom = cleanModelName(result?.nom);
    const confiance = clampConfidence(result?.confiance);
    if(nom.length < 2) return jsonResponse({ ok: false, configured: true, code: "cloudflare_empty_name" }, 502);
    return jsonResponse({ ok: true, configured: true, provider: "cloudflare", nom, confiance, model });
  } catch(error) {
    const code = error?.name === "AbortError"
      ? "cloudflare_timeout"
      : error instanceof Error && ["image_fetch_failed", "image_too_large", "image_type_not_allowed"].includes(error.message)
        ? error.message
        : "cloudflare_unavailable";
    return jsonResponse({ ok: false, configured: true, code }, 502);
  } finally {
    clearTimeout(timeoutId);
  }
});
