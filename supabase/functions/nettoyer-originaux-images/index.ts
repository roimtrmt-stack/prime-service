// La suppression automatique des originaux est désactivée définitivement.
// Cette fonction conservée comme stub empêche qu’un ancien appel ou un ancien
// cron puisse supprimer un fichier Storage par erreur.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve((req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Méthode non autorisée" }, 405);
  return jsonResponse({
    cleanup_disabled: true,
    deleted: 0,
    message: "La suppression automatique des originaux est désactivée.",
  });
});
