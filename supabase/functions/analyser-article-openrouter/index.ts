const PROJECT_REF = "kfxalpvbtbvkncztjwzc";
const ALLOWED_ORIGIN = "https://roimtrmt-stack.github.io";
const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_MODEL = "openrouter/free";

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

async function fetchImageAsData(imageUrl: string, signal: AbortSignal) {
  const imageResponse = await fetch(imageUrl, { method: "GET", redirect: "error", signal });
  if(!imageResponse.ok) throw new Error("image_fetch_failed");
  if(Number(imageResponse.headers.get("content-length") || 0) > 8 * 1024 * 1024) throw new Error("image_too_large");
  const mimeType = (imageResponse.headers.get("content-type") || "image/jpeg").split(";")[0].toLowerCase();
  if(!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType)) throw new Error("image_type_not_allowed");
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  if(bytes.length === 0 || bytes.length > 8 * 1024 * 1024) throw new Error("image_too_large");
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
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

function parseJsonObject(text: unknown) {
  const cleaned = String(text || "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if(start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

function extractContent(payload: any) {
  const content = payload?.choices?.[0]?.message?.content;
  if(typeof content === "string") return content.trim();
  if(Array.isArray(content)) return content.map((part) => typeof part?.text === "string" ? part.text : "").join("\n").trim();
  return "";
}

Deno.serve(async (request) => {
  if(request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if(request.method !== "POST") return jsonResponse({ ok: false, code: "method_not_allowed" }, 405);
  if(request.headers.get("origin") !== ALLOWED_ORIGIN) return jsonResponse({ ok: false, code: "origin_not_allowed" }, 403);

  let body: any;
  try { body = await request.json(); } catch { return jsonResponse({ ok: false, code: "invalid_json" }, 400); }
  if(!isAllowedImageUrl(body?.imageUrl)) return jsonResponse({ ok: false, code: "invalid_image_url" }, 400);

  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if(!apiKey) return jsonResponse({ ok: false, configured: false, code: "openrouter_not_configured" }, 503);
  const model = (Deno.env.get("OPENROUTER_VISION_MODEL") || DEFAULT_MODEL).trim().replace(/[^a-zA-Z0-9._/:-]/g, "");
  if(!model) return jsonResponse({ ok: false, configured: true, code: "openrouter_model_invalid" }, 503);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const imageDataUrl = await fetchImageAsData(body.imageUrl, controller.signal);
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://roimtrmt-stack.github.io/prime-service/",
        "X-Title": "Prime Service",
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: "Analyse uniquement ce qui est réellement visible sur la photo de l’article. Donne un nom commercial très court et élégant de 2 à 5 mots, en français, qui met en valeur l’aspect fort visible : couleur, matière, forme, finition ou style. N’invente aucune marque, taille, matière ou caractéristique invisible. Réponds uniquement avec un objet JSON : {\"nom\": string, \"confiance\": number entre 0 et 1}.",
            },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        }],
        temperature: 0.2,
        max_tokens: 120,
      }),
    });

    if(!response.ok) {
      let providerCode = "";
      try {
        const errorPayload = await response.clone().json();
        providerCode = String(errorPayload?.error?.code || errorPayload?.error?.type || "")
          .replace(/[^a-zA-Z0-9_.-]/g, "")
          .slice(0, 64);
      } catch {
        // Le fournisseur peut renvoyer une réponse non JSON ; le code HTTP suffit au fallback.
      }
      const code = response.status === 401 || response.status === 403
        ? "openrouter_key_rejected"
        : response.status === 404
          ? "openrouter_model_unavailable"
          : response.status === 400
            ? "openrouter_request_rejected"
            : response.status === 429
              ? "openrouter_quota_or_rate_limit"
              : "openrouter_unavailable";
      return jsonResponse({ ok: false, configured: true, code, provider_code: providerCode || undefined }, 502);
    }

    const payload = await response.json();
    const result = parseJsonObject(extractContent(payload));
    if(!result) return jsonResponse({ ok: false, configured: true, code: "openrouter_invalid_output" }, 502);
    const nom = cleanModelName(result?.nom);
    const confiance = clampConfidence(result?.confiance);
    if(nom.length < 2) return jsonResponse({ ok: false, configured: true, code: "openrouter_empty_name" }, 502);
    return jsonResponse({ ok: true, configured: true, provider: "openrouter", nom, confiance, model: payload?.model || model });
  } catch(error) {
    const code = error?.name === "AbortError"
      ? "openrouter_timeout"
      : error instanceof Error && ["image_fetch_failed", "image_too_large", "image_type_not_allowed"].includes(error.message)
        ? error.message
        : "openrouter_unavailable";
    return jsonResponse({ ok: false, configured: true, code }, 502);
  } finally {
    clearTimeout(timeoutId);
  }
});
