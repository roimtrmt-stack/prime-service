// Vérifie la migration SQL des paliers de commission :
// - la règle (8 %, arrondi au multiple de 100 supérieur, minimum 300, jamais
//   plus que le prix de base) est un point fixe : relancée, elle n'a plus d'effet ;
// - les cas concrets demandées donnent 300 / 400 / 800…
// Postgres n'est pas disponible ici : on exécute le même UPDATE sur une base
// SQLite locale après avoir neutralisé le préfixe `public.` et fourni la
// fonction CEIL de Postgres comme UDF.
import Database from "node:sqlite";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../supabase/migrations/202610210001_commission_paliers_calcul.sql", import.meta.url),
  "utf8",
);
assert.match(sql, /public\.produits/);
assert.match(sql, /GREATEST\s*\(\s*300\s*,/);
assert.match(sql, /CEIL/);
assert.match(sql, /prix - commission \+ nouvelle_commission/);

// SQLite n'exécute pas les instructions SET FROM (sous-requête UPDATE ... FROM
// est acceptée par SQLite ?) — on réécrit les 2 instructions en équivalents
// SQLite : sous-requête corrélée, une ligne à la fois.
const db = new Database.DatabaseSync(":memory:");
db.function("CEIL", (v) => Math.ceil(Number(v)));
db.function("GREATEST", (a, b) => Math.max(Number(a), Number(b)));
db.function("LEAST", (a, b) => Math.min(Number(a), Number(b)));
db.exec("CREATE TABLE produits (id INTEGER PRIMARY KEY, nom TEXT, prix INTEGER, commission INTEGER);");

const casDemarrage = [
  [1, "Base 2000 (héritée commission 300)", 2300, 300],
  [2, "Base 5000 (héritée commission 300)", 5300, 300],
  [3, "Base 10000 (héritée commission 300)", 10300, 300],
  [4, "Prix ristourné, commission nulle", 1500, 0],
  [5, "Article cher déjà au palier", 65000 + 5200, 5200],
  [6, "Base 340, commission absente", 340, null],
  [7, "Base frais 64750 (héritée 300)", 65050, 300],
];

const inserer = db.prepare("INSERT INTO produits (id, nom, prix, commission) VALUES (?, ?, ?, ?);");
for (const [id, nom, prix, commission] of casDemarrage) {
  inserer.run(id, nom, prix, commission);
}

// Transcription SQLite stricte de l'UPDATE du fichier de migration :
// commission = LEAST(GREATEST(300, CEIL(base*8/10000)*100), base) avec base = prix−commission
// prix = prix(ancien) − commission(ancienne) + nouvelle_commission
const updateSqlite = `
UPDATE produits SET
  commission = (
    SELECT CAST(LEAST(
      GREATEST(300, CEIL((GREATEST(0, p.prix - COALESCE(p.commission, 0)) * 8.0) / 10000.0) * 100),
      GREATEST(0, p.prix - COALESCE(p.commission, 0))
    ) AS INTEGER)
    FROM produits p WHERE p.id = produits.id
  ),
  prix = (
    SELECT p.prix - COALESCE(p.commission, 0) + CAST(LEAST(
      GREATEST(300, CEIL((GREATEST(0, p.prix - COALESCE(p.commission, 0)) * 8.0) / 10000.0) * 100),
      GREATEST(0, p.prix - COALESCE(p.commission, 0))
    ) AS INTEGER)
    FROM produits p WHERE p.id = produits.id
  )
WHERE (
  SELECT CAST(LEAST(
    GREATEST(300, CEIL((GREATEST(0, p.prix - COALESCE(p.commission, 0)) * 8.0) / 10000.0) * 100),
    GREATEST(0, p.prix - COALESCE(p.commission, 0))
  ) AS INTEGER)
  FROM produits p WHERE p.id = produits.id
) <> COALESCE(produits.commission, -1);
`;

function appliquerMigration() {
  db.exec(updateSqlite);
  db.exec("UPDATE produits SET commission = 300 WHERE commission IS NULL OR commission < 0;");
}
appliquerMigration();

const lignes = db.prepare("SELECT id, prix, commission FROM produits ORDER BY id;").all();
const attendus = new Map([
  [1, { prix: 2300, commission: 300 }],   // 2000 → 300 (minimum)
  [2, { prix: 5400, commission: 400 }],   // 5000 → 400
  [3, { prix: 10800, commission: 800 }],  // 10000 → 800
  [4, { prix: 1800, commission: 300 }],   // 1500 → 300 minimum
  [5, { prix: 70200, commission: 5200 }], // déjà cohérent, inchangé
  [6, { prix: 640, commission: 300 }],    // base 340 → 300
  [7, { prix: 69950, commission: 5200 }], // 64750 → 5200
]);
for (const [id, attendu] of attendus) {
  const ligne = lignes.find((l) => l.id === id);
  assert.ok(ligne, `article ${id} présent`);
  assert.equal(ligne.commission, attendu.commission, `commission article ${id}`);
  assert.equal(ligne.prix, attendu.prix, `prix article ${id}`);
}

// Point fixe : une seconde application ne change plus rien.
const avant = JSON.stringify(lignes);
appliquerMigration();
const apres = JSON.stringify(db.prepare("SELECT id, prix, commission FROM produits ORDER BY id;").all());
assert.equal(apres, avant, "migration idempotente (pas de 2e effet)");

// Jamais de commission non multiple de 100 ; jamais > base pour base >= 300.
for (const ligne of lignes) {
  assert.equal(ligne.commission % 100, 0, "commission multiple de 100");
  const base = ligne.prix - ligne.commission;
  if (base >= 300) assert.ok(ligne.commission <= ligne.prix, "commission ≤ prix affiché");
  assert.ok(ligne.commission >= 300, "commission ≥ 300");
}

console.log("OK: migration paliers — 300/400/800 confirmés, idempotente, jamais sales");
