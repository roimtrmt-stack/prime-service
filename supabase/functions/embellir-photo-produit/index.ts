import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "jsr:@cross/image@0.4.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "photos-articles";
const MAX_BATCH = 4;
const MAX_ATTEMPTS = 3;
const MAX_SOURCE_BYTES = 5_000_000;
const OUTPUT_SIZE = 1000;
const RETRY_DELAY_MS = 60_000;
const CLAIM_TIMEOUT_MS = 10 * 60_000;
type SupabaseClientLike = any;
type LooseRecord = Record<string, any>;

const ALLOWED_ORIGINS = new Set([
  "https://roimtrmt-stack.github.io",
  "https://primeservice.netlify.app",
  "http://localhost:4173",
  "http://localhost:5173",
]);

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

function clip(value: unknown, max = 240): string {
  const text = String(value ?? "");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function imagePathFromPublicUrl(source: string): string {
  const url = new URL(source);
  const expectedOrigin = new URL(SUPABASE_URL).origin;
  const prefix = `/storage/v1/object/public/${BUCKET}/`;
  if (url.protocol !== "https:" || url.origin !== expectedOrigin || !url.pathname.startsWith(prefix)) {
    throw new Error("Photo source non autorisée");
  }
  const encodedPath = url.pathname.slice(prefix.length);
  const path = encodedPath.split("/").map((part) => decodeURIComponent(part)).join("/");
  if (!path || path.includes("..") || path.startsWith("/")) throw new Error("Chemin photo invalide");
  return path;
}

async function downloadSourceImage(sourceUrl: string): Promise<Uint8Array> {
  const path = imagePathFromPublicUrl(sourceUrl);
  const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, { method: "GET", redirect: "error", cache: "no-store" });
  if (!response.ok) throw new Error(`Téléchargement photo HTTP ${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_SOURCE_BYTES) throw new Error("Photo trop volumineuse pour le traitement gratuit");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SOURCE_BYTES) throw new Error("Photo vide ou trop volumineuse");
  return bytes;
}

function applyExifOrientation(source: Image): Image {
  const orientation = Number(source.metadata?.orientation || 1);
  if (orientation === 3) return source.clone().rotate180();
  if (orientation === 6) return source.clone().rotate90();
  if (orientation === 8) return source.clone().rotate270();
  return source.clone();
}

function borderBackground(image: Image): { r: number; g: number; b: number; spread: number } {
  const { width, height, data } = image;
  const depth = Math.max(2, Math.round(Math.min(width, height) * 0.04));
  let r = 0, g = 0, b = 0, count = 0;
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 20) return;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
  };
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 80))) {
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 80))) {
      if (x < depth || x >= width - depth || y < depth || y >= height - depth) add(x, y);
    }
  }
  if (!count) return { r: 242, g: 242, b: 240, spread: 0 };
  r /= count; g /= count; b /= count;
  let spread = 0;
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 80))) {
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 80))) {
      if (x < depth || x >= width - depth || y < depth || y >= height - depth) {
        const i = (y * width + x) * 4;
        spread += Math.hypot(data[i] - r, data[i + 1] - g, data[i + 2] - b);
      }
    }
  }
  return { r, g, b, spread: spread / Math.max(1, count) };
}

export function detectContentBounds(image: Image): { left: number; top: number; right: number; bottom: number; reliable: boolean } {
  const { width, height, data } = image;
  const background = borderBackground(image);
  const threshold = clamp(22 + background.spread * 3.5, 30, 78);
  const step = Math.max(1, Math.floor(Math.min(width, height) / 420));
  let left = width, top = height, right = -1, bottom = -1, contentCount = 0, samples = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      samples++;
      if (data[i + 3] < 20) continue;
      const distance = Math.hypot(data[i] - background.r, data[i + 1] - background.g, data[i + 2] - background.b);
      if (distance <= threshold) continue;
      contentCount++;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }

  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  const reliable = contentCount >= samples * 0.008 && boxWidth >= width * 0.08 && boxHeight >= height * 0.08;
  if (!reliable) return { left: 0, top: 0, right: width - 1, bottom: height - 1, reliable: false };

  const padX = Math.max(8, Math.round(boxWidth * 0.10));
  const padY = Math.max(8, Math.round(boxHeight * 0.10));
  return {
    left: Math.max(0, left - padX),
    top: Math.max(0, top - padY),
    right: Math.min(width - 1, right + padX),
    bottom: Math.min(height - 1, bottom + padY),
    reliable: true,
  };
}

function buildStudioImage(source: Image): Promise<Uint8Array> {
  const bounds = detectContentBounds(source);
  const cropWidth = bounds.right - bounds.left + 1;
  const cropHeight = bounds.bottom - bounds.top + 1;
  const crop = source.clone().crop(bounds.left, bounds.top, cropWidth, cropHeight);
  const border = borderBackground(source);
  const borderAverage = (border.r + border.g + border.b) / 3;
  const studio = border.spread < 70 && borderAverage > 175
    ? { r: Math.round(clamp(border.r, 225, 252)), g: Math.round(clamp(border.g, 225, 252)), b: Math.round(clamp(border.b, 225, 252)) }
    : { r: 244, g: 244, b: 242 };

  if (bounds.reliable) {
    const innerLeft = Math.max(0, Math.round((bounds.left === 0 ? 0 : cropWidth * 0.10)));
    const innerTop = Math.max(0, Math.round((bounds.top === 0 ? 0 : cropHeight * 0.10)));
    const innerRight = Math.min(cropWidth, Math.round(cropWidth - (bounds.right === source.width - 1 ? 0 : cropWidth * 0.10)));
    const innerBottom = Math.min(cropHeight, Math.round(cropHeight - (bounds.bottom === source.height - 1 ? 0 : cropHeight * 0.10)));
    if (innerTop > 0) crop.fillRect(0, 0, cropWidth, innerTop, studio.r, studio.g, studio.b);
    if (innerBottom < cropHeight) crop.fillRect(0, innerBottom, cropWidth, cropHeight - innerBottom, studio.r, studio.g, studio.b);
    if (innerLeft > 0) crop.fillRect(0, innerTop, innerLeft, Math.max(0, innerBottom - innerTop), studio.r, studio.g, studio.b);
    if (innerRight < cropWidth) crop.fillRect(innerRight, innerTop, cropWidth - innerRight, Math.max(0, innerBottom - innerTop), studio.r, studio.g, studio.b);
  }

  crop.brightness(0.035).contrast(0.075).saturation(0.035).sharpen(0.12);
  const available = Math.round(OUTPUT_SIZE * 0.90);
  const scale = Math.min(available / crop.width, available / crop.height);
  const resized = crop.resize({
    width: Math.max(1, Math.round(crop.width * scale)),
    height: Math.max(1, Math.round(crop.height * scale)),
    method: "bicubic",
    fit: "stretch",
  });
  const canvas = Image.create(OUTPUT_SIZE, OUTPUT_SIZE, studio.r, studio.g, studio.b, 255);
  canvas.composite(resized, Math.round((OUTPUT_SIZE - resized.width) / 2), Math.round((OUTPUT_SIZE - resized.height) / 2));
  return canvas.encode("jpeg", { quality: 88, progressive: true });
}

export async function optimiseSource(bytes: Uint8Array): Promise<Uint8Array> {
  const decoded = await Image.decode(bytes, { tolerantDecoding: true });
  const oriented = applyExifOrientation(decoded);
  return buildStudioImage(oriented);
}

async function markFailed(
  supabase: SupabaseClientLike,
  job: LooseRecord,
  error: unknown,
): Promise<void> {
  const attempts = Number(job.attempts || 0);
  const terminal = attempts >= MAX_ATTEMPTS;
  await supabase
    .from("traitements_images_produits")
    .update({
      status: terminal ? "echec" : "en_attente",
      next_attempt_at: terminal ? null : new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
      finished_at: terminal ? new Date().toISOString() : null,
      started_at: null,
      last_error: clip(error instanceof Error ? error.message : error),
    })
    .eq("id", job.id)
    .eq("status", "en_traitement");
}

async function processJob(supabase: SupabaseClientLike, job: LooseRecord): Promise<LooseRecord> {
  const currentAttempts = Number(job.attempts || 0);
  const { data: claimed, error: claimError } = await supabase
    .from("traitements_images_produits")
    .update({
      status: "en_traitement",
      attempts: currentAttempts + 1,
      started_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", job.id)
    .eq("status", "en_attente")
    .eq("attempts", currentAttempts)
    .select("id, produit_id, source_image_url, attempts")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { id: job.id, status: "déjà réservé" };

  try {
    const { data: product, error: productError } = await supabase
      .from("produits")
      .select("id, image_url")
      .eq("id", claimed.produit_id)
      .maybeSingle();
    if (productError) throw productError;
    if (!product || product.image_url !== claimed.source_image_url) {
      await supabase.from("traitements_images_produits").update({ status: "obsolete", finished_at: new Date().toISOString(), started_at: null, last_error: null }).eq("id", claimed.id).eq("status", "en_traitement");
      return { id: claimed.id, status: "source remplacée" };
    }

    const sourceBytes = await downloadSourceImage(claimed.source_image_url);
    const optimizedBytes = await optimiseSource(sourceBytes);
    const outputPath = `optimized/${claimed.produit_id}-${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(outputPath, optimizedBytes, {
      contentType: "image/jpeg",
      cacheControl: "31536000",
      upsert: false,
    });
    if (uploadError) throw uploadError;
    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(outputPath);
    const optimizedUrl = publicData?.publicUrl;
    if (!optimizedUrl) throw new Error("URL optimisée introuvable");

    const { data: updatedProduct, error: updateError } = await supabase
      .from("produits")
      .update({ image_url: optimizedUrl })
      .eq("id", claimed.produit_id)
      .eq("image_url", claimed.source_image_url)
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updatedProduct) {
      await supabase.storage.from(BUCKET).remove([outputPath]);
      await supabase.from("traitements_images_produits").update({ status: "obsolete", finished_at: new Date().toISOString(), started_at: null, last_error: "Article modifié pendant le traitement" }).eq("id", claimed.id).eq("status", "en_traitement");
      return { id: claimed.id, status: "article modifié" };
    }

    await supabase.from("traitements_images_produits").update({ status: "termine", optimized_image_url: optimizedUrl, finished_at: new Date().toISOString(), started_at: null, last_error: null }).eq("id", claimed.id).eq("status", "en_traitement");
    return { id: claimed.id, produit_id: claimed.produit_id, status: "termine" };
  } catch (error) {
    await markFailed(supabase, claimed, error);
    return { id: claimed.id, status: "echec_ou_reprise", error: clip(error instanceof Error ? error.message : error) };
  }
}

async function processPending(supabase: SupabaseClientLike): Promise<LooseRecord[]> {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString();
  await supabase
    .from("traitements_images_produits")
    .update({ status: "en_attente", next_attempt_at: now, started_at: null, last_error: "Reprise automatique après interruption" })
    .eq("status", "en_traitement")
    .lt("started_at", staleBefore);

  const { data: pending, error } = await supabase
    .from("traitements_images_produits")
    .select("id, produit_id, source_image_url, status, attempts, next_attempt_at")
    .eq("status", "en_attente")
    .lte("next_attempt_at", now)
    .order("next_attempt_at", { ascending: true })
    .limit(MAX_BATCH);
  if (error) throw error;

  const results: LooseRecord[] = [];
  for (const job of pending || []) {
    results.push(await processJob(supabase, job));
  }
  return results;
}

if (import.meta.main) {
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
    if (req.method !== "POST") return jsonResponse(req, { error: "Méthode non autorisée" }, 405);
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return jsonResponse(req, { error: "Configuration serveur incomplète" }, 500);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    try {
      const results = await processPending(supabase);
      console.log("[embellir-photo-produit]", JSON.stringify({ processed: results.length, results }));
      return jsonResponse(req, { processed: results.length, results });
    } catch (error) {
      console.error("[embellir-photo-produit]", error);
      return jsonResponse(req, { error: clip(error instanceof Error ? error.message : error) }, 500);
    }
  });
}
