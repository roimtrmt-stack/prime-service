import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "photos-articles";
const RETENTION_MS = 48 * 60 * 60 * 1000;
const MAX_BATCH = 50;

type SupabaseClientLike = any;
type LooseRecord = Record<string, any>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
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
    throw new Error("Chemin d’original invalide");
  }
  return path;
}

async function markDeleted(supabase: SupabaseClientLike, job: LooseRecord): Promise<void> {
  const { error } = await supabase
    .from("traitements_images_produits")
    .update({ source_deleted_at: new Date().toISOString(), last_error: null })
    .eq("id", job.id)
    .eq("status", "termine")
    .is("source_deleted_at", null);
  if (error) throw error;
}

async function cleanupJob(supabase: SupabaseClientLike, job: LooseRecord): Promise<LooseRecord> {
  if (!job.source_image_url || !job.optimized_image_url || !job.finished_at) {
    return { id: job.id, status: "ignore_donnees_incompletes" };
  }

  const { data: product, error: productError } = await supabase
    .from("produits")
    .select("id, image_url")
    .eq("id", job.produit_id)
    .maybeSingle();
  if (productError) throw productError;

  // Ne supprimer que si la photo optimisée est encore celle du produit.
  if (!product || product.image_url !== job.optimized_image_url) {
    return { id: job.id, status: "ignore_source_non_confirmee" };
  }

  // Ne jamais supprimer une source encore partagée par un autre article.
  const { data: references, error: referenceError } = await supabase
    .from("produits")
    .select("id")
    .eq("image_url", job.source_image_url)
    .limit(1);
  if (referenceError) throw referenceError;
  if ((references || []).length > 0) {
    return { id: job.id, status: "ignore_source_partagee" };
  }

  const sourcePath = imagePathFromPublicUrl(job.source_image_url);
  const { error: removeError } = await supabase.storage.from(BUCKET).remove([sourcePath]);
  if (removeError) throw removeError;

  await markDeleted(supabase, job);
  return { id: job.id, produit_id: job.produit_id, status: "original_supprime" };
}

async function processPending(supabase: SupabaseClientLike): Promise<LooseRecord[]> {
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  const { data: jobs, error } = await supabase
    .from("traitements_images_produits")
    .select("id, produit_id, source_image_url, optimized_image_url, finished_at")
    .eq("status", "termine")
    .is("source_deleted_at", null)
    .not("optimized_image_url", "is", null)
    .lt("finished_at", cutoff)
    .order("finished_at", { ascending: true })
    .limit(MAX_BATCH);
  if (error) throw error;

  const results: LooseRecord[] = [];
  for (const job of jobs || []) {
    try {
      results.push(await cleanupJob(supabase, job));
    } catch (error) {
      results.push({
        id: job.id,
        status: "echec_nettoyage",
        error: clip(error instanceof Error ? error.message : error),
      });
    }
  }
  return results;
}

if (import.meta.main) {
  Deno.serve(async (req: Request) => {
    if (req.method !== "POST") return jsonResponse({ error: "Méthode non autorisée" }, 405);
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ error: "Configuration serveur incomplète" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    try {
      const results = await processPending(supabase);
      console.log("[nettoyer-originaux-images]", JSON.stringify({ processed: results.length, results }));
      return jsonResponse({ processed: results.length, results });
    } catch (error) {
      console.error("[nettoyer-originaux-images]", error);
      return jsonResponse({ error: clip(error instanceof Error ? error.message : error) }, 500);
    }
  });
}

export { cleanupJob, processPending };
