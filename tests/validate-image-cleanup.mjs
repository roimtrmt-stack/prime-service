import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

const cleanupFunction = await read("supabase/functions/nettoyer-originaux-images/index.ts");
const cleanupMigration = await read("supabase/migrations/202608260001_disable_original_cleanup.sql");
const supabaseConfig = await read("supabase/config.toml");
const deployWorkflow = await read(".github/workflows/deploy-functions.yml");

assert.match(cleanupFunction, /cleanup_disabled: true/);
assert.match(cleanupFunction, /deleted: 0/);
assert.doesNotMatch(cleanupFunction, /storage\.from\(.*\)\.remove|RETENTION_MS|processPending|cleanupJob|SUPABASE_SERVICE_ROLE_KEY/);
assert.match(cleanupMigration, /cron\.unschedule\('nettoyer-originaux-images'\)/);
assert.doesNotMatch(cleanupMigration, /cron\.schedule|net\.http_post/);
assert.doesNotMatch(supabaseConfig, /functions\.nettoyer-originaux-images/);
assert.doesNotMatch(deployWorkflow, /functions deploy nettoyer-originaux-images/);

console.log("OK: suppression automatique des originaux désactivée et non destructive");
