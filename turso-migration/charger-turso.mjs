// Chargement de la veille Prime Service vers Turso (libSQL).
//
// Remplit une base Turso avec le contenu de prime-service-veille.sql
// (produit par exporter-supabase.py : schéma + données), puis vérifie les
// décomptes par table. Le site actif reste sur Supabase — ce script ne
// touche à rien d'autre.
//
// Utilisation :
//   node charger-turso.mjs <url-turso> <fichier-jeton-turso>
//   exemple : node charger-turso.mjs "libsql://prime-service-x.turso.io" "jeton.txt"
// Le fichier jeton contient un jeton Turso (créé dans le tableau de bord
// Turso → Settings → API Tokens). Le jeton n'est ni affiché, ni enregistré
// dans le dépôt.
//
// Dépendance : @libsql/client (npm install @libsql/client dans ce dossier).

import { createClient } from "@libsql/client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [url, fichierJeton] = process.argv.slice(2);
if (!url || !fichierJeton) {
  console.error("usage : node charger-turso.mjs <url-turso> <fichier-jeton-turso>");
  process.exit(1);
}

const jeton = fs
  .readFileSync(fichierJeton.startsWith("~") ? fichierJeton.replace("~", os.homedir()) : fichierJeton, "utf8")
  .trim();
if (jeton.length < 10) {
  console.error("Fichier jeton vide ou trop court — rien à faire.");
  process.exit(1);
}

const ici = path.dirname(fileURLToPath(import.meta.url));
const cheminSql = path.join(ici, "prime-service-veille.sql");
if (!fs.existsSync(cheminSql)) {
  console.error("Fichier introuvable :", cheminSql, "— lancez d'abord exporter-supabase.py.");
  process.exit(1);
}

const source = fs.readFileSync(cheminSql, "utf8");

// Découpage des instructions : le SQL exporté ne contient ni triggers ni
// procédures, on sépare sur les ";" hors littéraux (guillemets) et on ignore
// les lignes de commentaires.
const instructions = [];
let courant = "";
let guillemets = 0;
for (const c of source) {
  if (c === "'") guillemets ^= 1;
  courant += c;
  if (c === ";" && guillemets === 0) {
    instructions.push(courant);
    courant = "";
  }
}
if (courant.trim().length > 0) instructions.push(courant);

const utiles = instructions
  .map((sql) => sql.trim())
  .filter((sql) => sql.length > 1 && !sql.split("\n").every((l) => l.trim().startsWith("--") || l.trim() === ""));

console.log(`Instructions SQL à envoyer : ${utiles.length}`);

const client = createClient({ url, authToken: jeton });

const PAQUET = 60;
for (let debut = 0; debut < utiles.length; debut += PAQUET) {
  const lot = utiles.slice(debut, debut + PAQUET).map((sql) => ({ sql }));
  await client.batch(lot, "write");
  console.log(`  ${Math.min(debut + PAQUET, utiles.length)}/${utiles.length} instructions envoyées`);
}

const TABLES_VERIF = [
  "parametres",
  "produits",
  "commandes",
  "notifications_generales",
  "notifications_boutiquiers",
  "suivis_notifications_boutiquiers",
  "abonnements_push",
  "traitements_images_produits",
  "site_visites",
];

console.log("\nVérification après chargement :");
let total = 0;
for (const table of TABLES_VERIF) {
  const res = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`);
  const n = Number(res.rows[0].n);
  total += n;
  console.log(`  ${table} : ${n} lignes`);
}
console.log(`\n✅ Base Turso alimentée — ${total} lignes au total.`);
console.log("Attention : le site actif reste sur Supabase. La base Turso est en veille.");
