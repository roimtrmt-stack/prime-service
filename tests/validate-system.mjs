import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

const index = await read("index.html");
const inscription = await read("inscription.html");
const orderFunction = await read("supabase/functions/envoyer-commande/index.ts");
const orangeShared = await read("supabase/functions/_shared/orange-sms.ts");
const orangeFunction = await read("supabase/functions/envoyer-sms-orange/index.ts");
const manualNotificationFunction = await read("supabase/functions/notifier-commande-manuellement/index.ts");
const inscriptionFunction = await read("supabase/functions/envoyer-inscription/index.ts");
const inscriptionPage = await read("inscription.html");
const retryFunction = await read("supabase/functions/notifier-boutiquier/index.ts");
const ackFunction = await read("supabase/functions/accuser-notification/index.ts");
const linkFunction = await read("supabase/functions/lier-notification-push/index.ts");
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
assert.match(orderFunction, /sendOrangeSms/);
assert.match(orderFunction, /sendBoutiqueSms/);
assert.match(orderFunction, /orangeCommandMessage/);
assert.match(orderFunction, /clipWithSuffix/);
assert.match(orderFunction, /activationUrl/);
assert.match(orderFunction, /EdgeRuntime/);
assert.match(orderFunction, /allowed_mentions/);
assert.match(orderFunction, /attachment:\/\//);
assert.doesNotMatch(orderFunction, /WHATSAPP_TEMPLATE_NAME|WHATSAPP_TOKEN|graph\.facebook\.com/);
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
assert.match(orangeShared, /api\.orange\.com\/oauth\/v3\/token/);
assert.match(orangeShared, /outbound\/\$\{encodeURIComponent\(senderAddress\)\}\/requests/);
assert.match(orangeShared, /ORANGE_CLIENT_ID/);
assert.match(orangeShared, /ORANGE_CLIENT_SECRET/);
assert.match(orangeShared, /MAX_SMS_LENGTH = 160/);
assert.match(orangeFunction, /requireAdmin/);
assert.match(orangeFunction, /from\("commandes"\)/);
assert.match(orangeFunction, /sendOrangeSmsBatch/);
assert.match(orangeFunction, /ORANGE_SMS_ENABLED/);
assert.match(manualNotificationFunction, /notifications_boutiquiers/);
assert.match(manualNotificationFunction, /notifier-boutiquier/);
assert.match(manualNotificationFunction, /ack_token/);
assert.match(manualNotificationFunction, /requireAdmin/);
assert.doesNotMatch(manualNotificationFunction, /ORANGE_CLIENT_SECRET|TEXTBEE_API_KEY/);
assert.match(index, /clever-processor/);
assert.match(index, /envoyer-sms-orange/);
assert.match(index, /envoyerSmsOrange/);
assert.match(index, /notifier-commande-manuellement/);
assert.match(index, /envoyerNotifBoutiquierPushDirect/);
assert.match(index, /id="messageNotification"[^>]*maxlength="160"/);

assert.match(inscriptionFunction, /DISCORD_WEBHOOK_INSCRIPTION/);
assert.match(inscriptionFunction, /recipient: "owner"/);
assert.match(inscriptionFunction, /multipart\/form-data/);
assert.match(inscriptionPage, /autorisationNotifBoutique/);
assert.match(inscriptionPage, /id="autorisationNotifBoutique" required/);
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
const bindingMigration = await read("supabase/migrations/202608210004_secure_push_subscription_binding.sql");
assert.match(bindingMigration, /telephone_boutique IS NULL/);
assert.match(inscription, /erreurUpload/);
assert.match(inscription, /getPublicUrl/);
assert.match(inscription, /erreurInsertion/);
assert.match(index, /#144#/);
assert.match(index, /94 13 44 08/);
assert.match(index, /carteClientMerci/);
assert.match(index, /lier-notification-push/);
assert.doesNotMatch(index, /telephone_boutique: numeroBoutique/);
assert.doesNotMatch(inscriptionPage, /abonnements_push.*telephone_boutique/);
assert.doesNotMatch(inscriptionPage, /supabaseClient\.from\("abonnements_push"\)/);
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
assert.match(linkFunction, /notifications_boutiquiers/);
assert.match(linkFunction, /ack_token/);
assert.match(linkFunction, /abonnements_push/);
assert.match(boutiquePage, /J’AI VU LA COMMANDE/);

console.log("OK: frontend syntax, secure order path, push preserved, Orange SMS paths, owner-only inscription path and Storage upload checks");
