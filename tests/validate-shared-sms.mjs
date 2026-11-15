// Vérifie que chaque fonction garde une copie IDENTIQUE du module SMS partagé
// et qu'aucune n'importe plus un fichier en dehors de son propre dossier.
// Raison : le bundler côté serveur (CLI Supabase récente) ne résout pas les
// imports du type « ../_shared/… », ce qui faisait échouer tout le déploiement.
import { readFile } from "node:fs/promises";

const CANONIQUE = "supabase/functions/_shared/orange-sms.ts";
// envoyer-commande n'a plus de copie SMS : son module SMS est embarqué dans
// index.ts (fichier autonome). Seul l'e-mail vit dans un fichier séparé.
const FONCTIONS = [
  "acces-boutiquier",
  "envoyer-sms-orange",
  "notifier-commande-manuellement",
];

const canonique = await readFile(CANONIQUE, "utf8");
let erreurs = 0;

for (const fn of FONCTIONS) {
  const chemin = `supabase/functions/${fn}/orange-sms.ts`;
  let copie = "";
  try {
    copie = await readFile(chemin, "utf8");
  } catch {
    console.error(`MANQUANT : ${chemin}`);
    erreurs += 1;
    continue;
  }
  if (copie !== canonique) {
    console.error(`DIFFÉRENT : ${chemin} ne correspond plus à ${CANONIQUE}`);
    erreurs += 1;
  }
  const entree = await readFile(`supabase/functions/${fn}/index.ts`, "utf8");
  if (entree.includes('"../_shared/') || entree.includes("'../_shared/")) {
    console.error(`IMPORT INTERDIT : supabase/functions/${fn}/index.ts importe ../_shared/…`);
    erreurs += 1;
  }
}

// envoyer-commande doit rester autonome, hors module d'e-mail explicite.
const commande = await readFile("supabase/functions/envoyer-commande/index.ts", "utf8");
const importsLocaux = [...commande.matchAll(/from\s+["'](\.\/[^"']+)["']/g)].map((m) => m[1]);
const importInterdit = importsLocaux.find((chemin) => chemin !== "./email-commande.ts");
if (importInterdit) {
  console.error(`IMPORT INATTENDU : envoyer-commande/index.ts importe ${importInterdit}`);
  erreurs += 1;
}
if (!commande.includes("orangeNormalizeMaliPhone")) {
  console.error("MANQUANT : module SMS embarqué absent de envoyer-commande/index.ts");
  erreurs += 1;
}

if (erreurs > 0) {
  console.error(`ÉCHEC : ${erreurs} problème(s) d'import partagé.`);
  process.exit(1);
}

console.log("OK: module SMS identique dans chaque fonction et aucun import hors dossier de fonction");
