const source = await Deno.readTextFile("supabase/functions/nettoyer-originaux-images/index.ts");

if (!source.includes("cleanup_disabled: true")) throw new Error("Le nettoyeur n’est pas marqué comme désactivé");
if (!source.includes("deleted: 0")) throw new Error("Le nettoyeur ne garantit pas zéro suppression");
if (/storage\.from\(.*\)\.remove|RETENTION_MS|processPending|cleanupJob/.test(source)) {
  throw new Error("Une logique de suppression automatique est encore présente");
}

console.log("OK: le test du nettoyeur confirme l’absence de suppression automatique");
