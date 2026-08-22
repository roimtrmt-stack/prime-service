import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

const cleanupFunction = await read("supabase/functions/nettoyer-originaux-images/index.ts");
const cleanupMigration = await read("supabase/migrations/202608220012_cleanup_processed_product_images.sql");
const supabaseConfig = await read("supabase/config.toml");
const deployWorkflow = await read(".github/workflows/deploy-functions.yml");

assert.match(cleanupFunction, /RETENTION_MS = 48 \* 60 \* 60 \* 1000/);
assert.match(cleanupFunction, /source_deleted_at/);
assert.match(cleanupFunction, /image_url !== job\.optimized_image_url/);
assert.match(cleanupFunction, /source_partagee/);
assert.match(cleanupFunction, /storage\.from\(BUCKET\)\.remove/);
assert.match(cleanupMigration, /add column if not exists source_deleted_at/);
assert.match(cleanupMigration, /traitements_images_produits_cleanup_idx/);
assert.match(cleanupMigration, /nettoyer-originaux-images/);
assert.match(supabaseConfig, /functions\.nettoyer-originaux-images/);
assert.match(deployWorkflow, /functions deploy nettoyer-originaux-images/);

console.log("OK: configuration, migration et garde-fous du nettoyage validés");
