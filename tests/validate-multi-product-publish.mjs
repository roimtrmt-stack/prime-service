import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const page = await readFile(new URL("../inscription.html", import.meta.url), "utf8");

assert.match(page, /for\(const photo of photosAjoutees\)/);
assert.match(page, /\.from\("produits"\)\s*\n\s*\.insert\(nouvelArticle\)/);
assert.match(page, /Chaque photo sélectionnée devient une ligne distincte/);
assert.match(page, /resultatsArticles\.length\}\/\$\{totalSoumis\}/);
assert.doesNotMatch(page, /fusionner_stock_si_meme_boutique|trouverArticleEquivalent|action:\s*"fusion"/);
assert.doesNotMatch(page, /chargerSignaturePhoto|scoreRessemblancePhoto/);

console.log("OK: chaque photo d’un lot multi-produit est publiée indépendamment et comptée");
