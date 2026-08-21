import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

const index = await read("index.html");
const inscription = await read("inscription.html");
const orderFunction = await read("supabase/functions/envoyer-commande/index.ts");
const inscriptionFunction = await read("supabase/functions/envoyer-inscription/index.ts");
const migration = await read("supabase/migrations/202608210001_secure_order_writes.sql");

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

for (const [name, html] of [["index.html", index], ["inscription.html", inscription]]) {
  for (const [i, script] of inlineScripts(html).entries()) {
    try {
      // Compilation only : aucun script frontend n’est exécuté dans ce test.
      Function(script); // eslint-disable-line no-new-func
    } catch (error) {
      throw new Error(`${name}, script inline #${i + 1}: ${error.message}`);
    }
  }
}

assert.match(index, /functions\/v1\/envoyer-commande/);
assert.match(index, /panier\.map\(article => \(\{[\s\S]*?id: article\.id/);
assert.doesNotMatch(index, /from\("commandes"\)\s*\.insert/);
assert.doesNotMatch(index, /from\("notifications_boutiquiers"\)\s*\.insert/);
assert.doesNotMatch(index, /DISCORD_WEBHOOK_URL\s*:\s*["'][^"']+["']/);

assert.match(orderFunction, /decrement_stock_batch/);
assert.match(orderFunction, /from\("commandes"\)/);
assert.match(orderFunction, /DISCORD_WEBHOOK_URL/);
assert.match(orderFunction, /TEXTBEE_API_KEY/);
assert.match(orderFunction, /EdgeRuntime/);
assert.match(orderFunction, /allowed_mentions/);
assert.match(orderFunction, /roimtrmt-stack\.github\.io/);
assert.doesNotMatch(orderFunction, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*["'][^"']+["']/);

assert.match(inscriptionFunction, /DISCORD_WEBHOOK_INSCRIPTION/);
assert.match(inscriptionFunction, /recipient: "owner"/);
assert.doesNotMatch(inscriptionFunction, /TEXTBEE_API_KEY/);
assert.doesNotMatch(inscriptionFunction, /telephone_boutique/);

assert.match(migration, /drop policy if exists "Insertion publique des commandes"/);
assert.match(migration, /revoke insert on table public\.commandes/);
assert.match(migration, /revoke insert on table public\.notifications_boutiquiers/);

console.log("OK: frontend syntax, secure order path, owner-only inscription path and RLS migration");
