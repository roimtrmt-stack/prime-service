const PROJECT_REF = "kfxalpvbtbvkncztjwzc";
const ALLOWED_ORIGIN = "https://roimtrmt-stack.github.io";
const MAX_IMAGE_URL_LENGTH = 2048;
const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_MODEL = "qwen/qwen3.6-27b";

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
  if(typeof value !== "string" || value.length < 20 || value.length > MAX_IMAGE_URL_LENGTH) return false;
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
  const declaredLength = Number(imageResponse.headers.get("content-length") || 0);
  if(declaredLength > 8 * 1024 * 1024) throw new Error("image_too_large");
  const mimeType = (imageResponse.headers.get("content-type") || "image/jpeg").split(";")[0].toLowerCase();
  if(!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mimeType)) throw new Error("image_type_not_allowed");
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  if(bytes.length === 0 || bytes.length > 8 * 1024 * 1024) throw new Error("image_too_large");
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

function extractContent(payload: any) {
  const content = payload?.choices?.[0]?.message?.content;
  if(typeof content === "string") return content.trim();
  if(Array.isArray(content)) return content.map((part) => typeof part?.text === "string" ? part.text : "").join("\n").trim();
  return "";
}

function parseJsonObject(text: string) {
  const cleaned = String(text || "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if(start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

Deno.serve(async (request) => {
  if(request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if(request.method !== "POST") return jsonResponse({ ok: false, code: "method_not_allowed" }, 405);
  if(request.headers.get("origin") !== ALLOWED_ORIGIN) return jsonResponse({ ok: false, code: "origin_not_allowed" }, 403);

  let body: any;
  try { body = await request.json(); } catch { return jsonResponse({ ok: false, code: "invalid_json" }, 400); }
  if(!isAllowedImageUrl(body?.imageUrl)) return jsonResponse({ ok: false, code: "invalid_image_url" }, 400);

  const apiKey = Deno.env.get("GROQ_API_KEY")?.trim();
  if(!apiKey) return jsonResponse({ ok: false, configured: false, code: "groq_not_configured" }, 503);
  const model = (Deno.env.get("GROQ_VISION_MODEL") || DEFAULT_MODEL).trim().replace(/[^a-zA-Z0-9._/-]/g, "");
  if(!model) return jsonResponse({ ok: false, configured: true, code: "groq_model_invalid" }, 503);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const imageDataUrl = await fetchImageAsData(body.imageUrl, controller.signal);
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
        temperature: 1,
        top_p: 1,
        max_completion_tokens: 120,
        stream: false,
      }),
    });

    if(!groqResponse.ok) {
      let providerCode = "";
      try {
        const errorPayload = await groqResponse.clone().json();
        providerCode = String(errorPayload?.error?.code || "")
          .replace(/[^a-zA-Z0-9_.-]/g, "")
          .slice(0, 64);
      } catch {
        // Le fournisseur peut renvoyer une réponse non JSON ; le code HTTP suffit au fallback.
      }
      const code = groqResponse.status === 401 || groqResponse.status === 403
        ? "groq_key_rejected"
        : groqResponse.status === 404
          ? "groq_model_unavailable"
          : groqResponse.status === 400
            ? "groq_request_rejected"
            : groqResponse.status === 429
              ? "groq_quota_or_rate_limit"
              : "groq_unavailable";
      return jsonResponse({ ok: false, configured: true, code, provider_code: providerCode || undefined }, 502);
    }
    const payload = await groqResponse.json();
    const result = parseJsonObject(extractContent(payload));
    if(!result) return jsonResponse({ ok: false, configured: true, code: "groq_invalid_output" }, 502);
    const nom = cleanModelName(result?.nom);
    const confiance = clampConfidence(result?.confiance);
    if(nom.length < 2) return jsonResponse({ ok: false, configured: true, code: "groq_empty_name" }, 502);
    return jsonResponse({ ok: true, configured: true, provider: "groq", nom, confiance });
  } catch(error) {
    const code = error?.name === "AbortError"
      ? "groq_timeout"
      : error instanceof Error && ["image_fetch_failed", "image_too_large", "image_type_not_allowed"].includes(error.message)
        ? error.message
        : "groq_unavailable";
    return jsonResponse({ ok: false, configured: true, code }, 502);
  } finally {
    clearTimeout(timeoutId);
  }
});
