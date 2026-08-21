import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

const index = await read("index.html");
const inscription = await read("inscription.html");
const orderFunction = await read("supabase/functions/envoyer-commande/index.ts");
const inscriptionFunction = await read("supabase/functions/envoyer-inscription/index.ts");
const retryFunction = await read("supabase/functions/notifier-boutiquier/index.ts");
const ackFunction = await read("supabase/functions/accuser-notification/index.ts");
const serviceWorker = await read("sw.js");
const boutiquePage = await read("boutique-notification.html");
const migration = await read("supabase/migrations/202608210001_secure_order_writes.sql");
const photoMigration = await read("supabase/migrations/202608210002_fix_public_photo_uploads.sql");
const retryMigration = await read("supabase/migrations/202608210003_boutiquier_notification_retries.sql");

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

for (const [name, html] of [["index.html", index], ["inscription.html", inscription]]) {
  for (const [i, script] of inlineScripts(html).entries()) {
    try {
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
assert.match(orderFunction, /attachment:\/\//);
assert.match(orderFunction, /WHATSAPP_TEMPLATE_NAME/);
assert.match(orderFunction, /WHATSAPP_TOKEN/);
assert.match(orderFunction, /Promise\.all/);
assert.match(orderFunction, /queueBoutiqueNotifications/);
assert.match(orderFunction, /ack_token/);
assert.match(orderFunction, /prochaine_tentative/);
const boutiqueBlock = orderFunction.match(/const boutiqueText = \[([\s\S]*?)\]\.join\(" \| "\)/)?.[1] || "";
assert.match(boutiqueBlock, /Montant NET à recevoir/);
assert.doesNotMatch(boutiqueBlock, /commission|marge|prix affiché|prix client/i);
assert.match(orderFunction, /\[notifications\] commande traitée/);
assert.match(orderFunction, /roimtrmt-stack\.github\.io/);
assert.doesNotMatch(orderFunction, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*["'][^"']+["']/);

assert.match(inscriptionFunction, /DISCORD_WEBHOOK_INSCRIPTION/);
assert.match(inscriptionFunction, /recipient: "owner"/);
assert.match(inscriptionFunction, /multipart\/form-data/);
assert.doesNotMatch(inscriptionFunction, /TEXTBEE_API_KEY/);
assert.doesNotMatch(inscriptionFunction, /telephone_boutique/);

assert.match(migration, /drop policy if exists "Insertion publique des commandes"/);
assert.match(migration, /revoke insert on table public\.commandes/);
assert.match(migration, /revoke insert on table public\.notifications_boutiquiers/);
assert.match(photoMigration, /file_size_limit = 8000000/);
assert.match(photoMigration, /Upload photos publics moderes/);
assert.match(retryMigration, /ack_token/);
assert.match(retryMigration, /cron\.schedule/);
assert.match(retryMigration, /\* \* \* \* \*/);
assert.match(retryMigration, /notifier-boutiquier/);
assert.match(inscription, /erreurUpload/);
assert.match(inscription, /getPublicUrl/);
assert.match(inscription, /erreurInsertion/);
assert.match(index, /#144#/);
assert.match(index, /94 13 44 08/);
assert.match(index, /carteClientMerci/);
assert.match(index, /telephone_boutique: numeroBoutique.length === 8/);
assert.match(serviceWorker, /notificationclick/);
assert.match(serviceWorker, /event\.action === "ack"/);
assert.match(serviceWorker, /actions: Array\.isArray/);
assert.match(retryFunction, /MAX_ATTEMPTS = 4/);
assert.match(retryFunction, /RETRY_DELAY_MS = 3 \* 60 \* 1000/);
assert.match(retryFunction, /J’AI VU LA COMMANDE/);
assert.match(retryFunction, /echec_definitif/);
assert.match(retryFunction, /escalateDiscord/);
assert.match(ackFunction, /ack_token/);
assert.match(ackFunction, /acknowledged_at/);
assert.match(boutiquePage, /J’AI VU LA COMMANDE/);

console.log("OK: frontend syntax, secure order path, routed notifications, owner-only inscription path and Storage upload checks");
