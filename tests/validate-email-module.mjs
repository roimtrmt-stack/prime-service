// Vérifie que le module d'e-mail de commande est identique dans chaque fonction
// qui l'utilise (copie locale obligatoire : le bundler ne résout pas _shared)
// et que les fonctions l'importent bien en local.
import { readFile } from "node:fs/promises";

const CANONIQUE = "supabase/functions/_shared/email-commande.ts";
const FONCTIONS = ["envoyer-commande", "notifier-boutiquier"];

const canonique = await readFile(CANONIQUE, "utf8");
let erreurs = 0;

for (const fn of FONCTIONS) {
  const chemin = `supabase/functions/${fn}/email-commande.ts`;
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
  if (!entree.includes('from "./email-commande.ts"')) {
    console.error(`IMPORT MANQUANT : supabase/functions/${fn}/index.ts n'importe pas ./email-commande.ts`);
    erreurs += 1;
  }
  if (entree.includes('"../_shared/')) {
    console.error(`IMPORT INTERDIT : supabase/functions/${fn}/index.ts importe ../_shared/…`);
    erreurs += 1;
  }
}

if (erreurs > 0) {
  console.error(`ÉCHEC : ${erreurs} problème(s) sur le module d'e-mail.`);
  process.exit(1);
}

console.log("OK: module d'e-mail identique dans chaque fonction et importé localement");
