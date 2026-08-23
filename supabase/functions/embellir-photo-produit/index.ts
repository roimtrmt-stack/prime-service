import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "jsr:@cross/image@0.4.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "photos-articles";
const MAX_BATCH = 4;
const MAX_ATTEMPTS = 3;
const MAX_SOURCE_BYTES = 8_000_000;
const MAX_WORKING_DIMENSION = 1400;
const OUTPUT_MAX_DIMENSION = 1200;
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

function imagePathFromPublicUrl(source: string): string {
  const url = new URL(source);
  const expectedOrigin = new URL(SUPABASE_URL).origin;
  const prefix = `/storage/v1/object/public/${BUCKET}/`;
  if (url.protocol !== "https:" || url.origin !== expectedOrigin || !url.pathname.startsWith(prefix)) {
    throw new Error("Photo source non autorisée");
  }
  const encodedPath = url.pathname.slice(prefix.length);
  const path = encodedPath.split("/").map((part) => decodeURIComponent(part)).join("/");
  if (!path || path.includes("..") || path.startsWith("/") || path.startsWith("optimized/")) {
    throw new Error("Chemin photo invalide");
  }
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

function outputFormatFromBytes(bytes: Uint8Array): "jpeg" | "png" {
  // Les formats non-JPEG (PNG, WebP, etc.) restent sans perte de fond alpha.
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return isJpeg ? "jpeg" : "png";
}

function resizeWithoutCropping(source: Image): Image {
  const largestSide = Math.max(source.width, source.height);
  if (largestSide <= OUTPUT_MAX_DIMENSION) return source;
  const scale = OUTPUT_MAX_DIMENSION / largestSide;
  return source.resize({
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
    method: "bicubic",
    fit: "stretch",
  });
}

export async function optimiseSource(bytes: Uint8Array): Promise<Uint8Array> {
  const decoded = await Image.decode(bytes, { tolerantDecoding: true });
  let working = applyExifOrientation(decoded);
  const largestSide = Math.max(working.width, working.height);
  if (largestSide > MAX_WORKING_DIMENSION) {
    const scale = MAX_WORKING_DIMENSION / largestSide;
    working = working.resize({
      width: Math.max(1, Math.round(working.width * scale)),
      height: Math.max(1, Math.round(working.height * scale)),
      method: "bilinear",
      fit: "stretch",
    });
  }
  const output = resizeWithoutCropping(working);
  const format = outputFormatFromBytes(bytes);
  return format === "png"
    ? output.encode("png")
    : output.encode("jpeg", { quality: 90, progressive: true });
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
    const outputFormat = outputFormatFromBytes(sourceBytes);
    const extension = outputFormat === "png" ? "png" : "jpg";
    const contentType = outputFormat === "png" ? "image/png" : "image/jpeg";
    const outputPath = `optimized/${claimed.produit_id}-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(outputPath, optimizedBytes, {
      contentType,
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
