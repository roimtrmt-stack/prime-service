const PROJECT_REF = "kfxalpvbtbvkncztjwzc";
const ALLOWED_ORIGIN = "https://roimtrmt-stack.github.io";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_MODEL = "gemini-3.7-flash";

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

function extractJsonText(payload: any) {
  const texts = [];
  const visit = (value: any, depth = 0) => {
    if(depth > 6 || value === null || value === undefined) return;
    if(typeof value === "string") return;
    if(Array.isArray(value)) {
      for(const item of value) visit(item, depth + 1);
      return;
    }
    if(typeof value !== "object") return;
    if(typeof value.text === "string") texts.push(value.text);
    if(typeof value.output_text === "string") texts.push(value.output_text);
    for(const [key, child] of Object.entries(value)) {
      if(key !== "text" && key !== "output_text") visit(child, depth + 1);
    }
  };
  visit(payload);
  return texts.filter(Boolean).join("\n").trim();
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

async function fetchImageAsInlineData(imageUrl: string, signal: AbortSignal) {
  const imageResponse = await fetch(imageUrl, { method: "GET", redirect: "error", signal });
  if(!imageResponse.ok) throw new Error("image_fetch_failed");
  const declaredLength = Number(imageResponse.headers.get("content-length") || 0);
  if(declaredLength > MAX_IMAGE_BYTES) throw new Error("image_too_large");
  const contentType = (imageResponse.headers.get("content-type") || "image/jpeg").split(";")[0].toLowerCase();
  if(!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType)) throw new Error("image_type_not_allowed");
  const bytes = new Uint8Array(await imageResponse.arrayBuffer());
  if(bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error("image_too_large");
  return { mimeType: contentType, data: bytesToBase64(bytes) };
}

Deno.serve(async (request) => {
  if(request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if(request.method !== "POST") return jsonResponse({ ok: false, code: "method_not_allowed" }, 405);
  const origin = request.headers.get("origin");
  if(origin !== ALLOWED_ORIGIN) return jsonResponse({ ok: false, code: "origin_not_allowed" }, 403);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, code: "invalid_json" }, 400);
  }
  if(!isAllowedImageUrl(body?.imageUrl)) return jsonResponse({ ok: false, code: "invalid_image_url" }, 400);

  const apiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
  if(!apiKey) return jsonResponse({ ok: false, configured: false, code: "gemini_not_configured" }, 503);

  const model = (Deno.env.get("GEMINI_VISION_MODEL") || DEFAULT_MODEL).trim().replace(/[^a-zA-Z0-9._-]/g, "");
  if(!model) return jsonResponse({ ok: false, configured: true, code: "gemini_model_invalid" }, 503);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const image = await fetchImageAsInlineData(body.imageUrl, controller.signal);
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            {
              text: "Analyse cette photo d’article. Identifie uniquement ce qui est réellement visible. Donne un nom commercial très court, élégant et valorisant (2 à 5 mots), sans prix, sans marque inventée, sans taille inventée et sans affirmation impossible à vérifier. Mets en avant l’aspect fort visible : couleur, matière, forme, finition ou style. Réponds uniquement avec cet objet JSON : {\"nom\": string, \"confiance\": number entre 0 et 1}.",
            },
            { inline_data: { mime_type: image.mimeType, data: image.data } },
          ],
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 80,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              nom: { type: "string" },
              confiance: { type: "number" },
            },
            required: ["nom", "confiance"],
          },
        },
      }),
    });

    if(!geminiResponse.ok) {
      const code = geminiResponse.status === 401 || geminiResponse.status === 403
        ? "gemini_key_rejected"
        : geminiResponse.status === 404
          ? "gemini_model_unavailable"
          : geminiResponse.status === 400
            ? "gemini_request_rejected"
            : geminiResponse.status === 429
              ? "gemini_quota_or_rate_limit"
              : "gemini_unavailable";
      return jsonResponse({ ok: false, configured: true, code }, 502);
    }
    const payload = await geminiResponse.json();
    const rawText = extractJsonText(payload);
    const result = parseJsonObject(rawText);
    if(!result) return jsonResponse({ ok: false, configured: true, code: "gemini_invalid_output" }, 502);
    const nom = cleanModelName(result?.nom);
    const confiance = clampConfidence(result?.confiance);
    if(nom.length < 2) return jsonResponse({ ok: false, configured: true, code: "gemini_empty_name" }, 502);
    return jsonResponse({ ok: true, configured: true, provider: "gemini", nom, confiance });
  } catch(error) {
    const code = error?.name === "AbortError"
      ? "gemini_timeout"
      : error instanceof Error && ["image_too_large", "image_type_not_allowed", "image_fetch_failed"].includes(error.message)
        ? error.message
        : "gemini_unavailable";
    return jsonResponse({ ok: false, configured: true, code }, 502);
  } finally {
    clearTimeout(timeoutId);
  }
});
