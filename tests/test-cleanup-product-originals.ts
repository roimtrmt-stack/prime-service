import { cleanupJob } from "../supabase/functions/nettoyer-originaux-images/index.ts";

const source = "https://kfxalpvbtbvkncztjwzc.supabase.co/storage/v1/object/public/photos-articles/originals/montre.jpg";
const optimized = "https://kfxalpvbtbvkncztjwzc.supabase.co/storage/v1/object/public/photos-articles/optimized/215-version.jpg";

function awaitable(result: unknown) {
  return {
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
}

function makeSupabase({ currentImageUrl = optimized, shared = false } = {}) {
  const removed: string[][] = [];
  const updated: unknown[] = [];
  let productReads = 0;
  const supabase = {
    from(table: string) {
      if (table === "produits") {
        return {
          select() {
            productReads += 1;
            if (productReads === 1) {
              return {
                eq() {
                  return { maybeSingle: async () => ({ data: { id: 215, image_url: currentImageUrl }, error: null }) };
                },
              };
            }
            return {
              eq() {
                return { limit: () => awaitable({ data: shared ? [{ id: 999 }] : [], error: null }) };
              },
            };
          },
        };
      }
      if (table === "traitements_images_produits") {
        return {
          update(payload: unknown) {
            updated.push(payload);
            return {
              eq() { return this; },
              is() { return awaitable({ data: null, error: null }); },
            };
          },
        };
      }
      throw new Error(`Table inattendue: ${table}`);
    },
    storage: {
      from(bucket: string) {
        if (bucket !== "photos-articles") throw new Error("Mauvais bucket");
        return {
          remove: async (paths: string[]) => {
            removed.push(paths);
            return { error: null };
          },
        };
      },
    },
  };
  return { supabase, removed, updated };
}

const job = {
  id: 7,
  produit_id: 215,
  source_image_url: source,
  optimized_image_url: optimized,
  finished_at: "2026-08-20T00:00:00.000Z",
};

const safe = makeSupabase();
const safeResult = await cleanupJob(safe.supabase, job);
if (safeResult.status !== "original_supprime") throw new Error("La source confirmée aurait dû être supprimée");
if (safe.removed.length !== 1 || safe.removed[0][0] !== "originals/montre.jpg") throw new Error("Chemin Storage supprimé incorrect");
if (safe.updated.length !== 1 || !(safe.updated[0] as Record<string, unknown>).source_deleted_at) throw new Error("Traçabilité de suppression absente");

const changed = makeSupabase({ currentImageUrl: source });
const changedResult = await cleanupJob(changed.supabase, job);
if (changedResult.status !== "ignore_source_non_confirmee" || changed.removed.length !== 0) throw new Error("Une source active ne doit jamais être supprimée");

const shared = makeSupabase({ shared: true });
const sharedResult = await cleanupJob(shared.supabase, job);
if (sharedResult.status !== "ignore_source_partagee" || shared.removed.length !== 0) throw new Error("Une source partagée ne doit jamais être supprimée");

console.log("OK: nettoyage différé protège les sources actives et partagées");
