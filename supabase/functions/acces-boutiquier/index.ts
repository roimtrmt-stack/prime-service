import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeMaliPhone } from "../_shared/orange-sms.ts";

/* =====================================================================
   ACCÈS « MODE BOUTIQUIER » — espace privé du boutiquier concerné.

   Les règles demandées par l'exploitant :
   1. Le numéro du boutiquier n'est ENREGISTRÉ en base qu'une seule fois :
      au moment où sa boutique publie PLUS de 5 articles (activer-si-eligible).
      Rien n'est enregistré pour les boutiques en dessous du seuil.
   2. Les boutiques qui dépassent le seuil « sont déjà dans le mode » : dès
      leur activation, mes-produits / modifier-produit fonctionnent sans
      nouvelle vérification (leur numéro enregistré doit correspondre au
      numéro réel du catalogue).
   3. Si TOUS les articles d'une boutique sont supprimés, son enregistrement
      est aussi effacé côté serveur (trigger SQL purge-boutique-vide + garde
      défensive ici) et l'accès est refusé.
   4. Les actions admin-* sont réservées au compte administrateur. Elles
      permettent à l'admin d'ouvrir et de gérer l'espace boutique de
      n'importe quelle boutique depuis l'espace vendeur.

   AUCUN jeton de session n'existe : la session réside sur l'appareil du
   boutiquier avec son numéro ; chaque action ré-authentifie nom + numéro.
   Le numéro de la boutique reste verrouillé : toute demande qui CONTIENT un
   numéro de boutique est refusée (403), côté code et côté serveur.
   ===================================================================== */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_EMAIL = (Deno.env.get("ADMIN_EMAIL") || "roimtrmt@gmail.com").toLowerCase();

const SEUIL_ARTICLES = 5;      // « plus de 5 articles » → 6 articles minimum
const PRIX_MINIMUM = 1000;
const SITE_ORIGIN = "https://roimtrmt-stack.github.io/prime-service";
const ALLOWED_ORIGINS = new Set([
  "https://roimtrmt-stack.github.io",
  "https://primeservice.netlify.app",
  "http://localhost:4173",
  "http://localhost:5173",
]);

function corsHeaders(req: Request): Headers {
  const origin = req.headers.get("origin") || "";
  return new Headers({
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://roimtrmt-stack.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  });
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  const headers = corsHeaders(req);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/* Même canonisation que le navigateur (cleBoutiqueCanonique) : minuscules
   locales + espaces multiples réduits. Les noms avec ou sans accents
   majuscules pointent toujours vers la même boutique. */
function canonBoutique(value: unknown): string {
  return text(value, 160).toLocaleLowerCase("fr-FR").replace(/\s+/g, " ");
}

function masquerTelephone(phone: string): string {
  const chiffres = phone.replace(/\D/g, ""); // ex 22394134408
  const national = chiffres.slice(-8);
  return `+223 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
}

async function requireAdmin(req: Request): Promise<Response | null> {
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return jsonResponse(req, { error: "Authentification administrateur requise" }, 401);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || data.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return jsonResponse(req, { error: "Accès administrateur refusé" }, 403);
  }
  return null;
}

type EtatBoutique = { nomAffiche: string; telephone: string; count: number };

/* Lecture du catalogue réel pour une boutique canonique : nom affiché,
   numéro d'enregistrement (source de vérité — AUCUN numéro du navigateur
   n'est jamais utilisé pour autre chose que la comparaison) + nombre
   d'articles actuellement publiés. */
async function etatBoutique(
  supabaseAdmin: ReturnType<typeof createClient>,
  nomCle: string,
): Promise<EtatBoutique | null> {
  const { data, error } = await supabaseAdmin
    .from("produits")
    .select("nom_boutique, telephone_boutique, telephone")
    .order("created_at", { ascending: false })
    .limit(1_000);
  if (error) throw new Error("Catalogue indisponible");
  let nomAffiche = "", numero = "", count = 0;
  for (const ligne of (data || []) as Record<string, unknown>[]) {
    if (canonBoutique(ligne.nom_boutique) !== nomCle) continue;
    count++;
    if (!nomAffiche) nomAffiche = text(ligne.nom_boutique, 160);
    if (!numero) {
      const candidat = normalizeMaliPhone((ligne.telephone_boutique as string) || (ligne.telephone as string) || "");
      if (candidat) numero = candidat;
    }
  }
  if (!nomAffiche) return null;
  return { nomAffiche, telephone: numero, count };
}

/* Purge défensive : une boutique sans articles côté serveur est effacée
   DEMANDÉ PAR L'EXPLOITANT. (Sa mutation SQL purge-boutique-vide fait la
   même chose de façon systématique ; ceci couvre les cas résiduels.) */
async function effacerEnregistrement(
  supabaseAdmin: ReturnType<typeof createClient>,
  nomCle: string,
): Promise<void> {
  try {
    await supabaseAdmin.from("acces_boutiquiers").delete().eq("nom_cle", nomCle);
  } catch (erreur) {
    console.error("[acces-boutiquier] purge impossible", erreur instanceof Error ? erreur.message : erreur);
  }
}

async function ligneAcces(
  supabaseAdmin: ReturnType<typeof createClient>,
  nomCle: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await supabaseAdmin
    .from("acces_boutiquiers")
    .select("*")
    .eq("nom_cle", nomCle)
    .maybeSingle();
  return (data as unknown as Record<string, unknown>) || null;
}

type AuthBoutique =
  | { erreur: [number, string] }
  | { nomCle: string; etat: EtatBoutique; ligne: Record<string, unknown> };

/* Authentifie une boutique : nom canonique + numéro correspondant au
   catalogue + seuil d'articles toujours respecté + enregistrement existant. */
async function authentifierBoutique(
  supabaseAdmin: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
): Promise<AuthBoutique> {
  const nomCle = canonBoutique(body.nom_boutique);
  if (!nomCle) return { erreur: [400, "Nom de boutique manquant"] };
  const etat = await etatBoutique(supabaseAdmin, nomCle);
  if (!etat) return { erreur: [404, "Aucune boutique ne porte ce nom."] };
  if (etat.count === 0) {
    await effacerEnregistrement(supabaseAdmin, nomCle);
    return { erreur: [403, "Votre boutique n'a plus d'articles publiés : l'accès est désactivé."] };
  }
  if (etat.count <= SEUIL_ARTICLES) {
    const manquants = SEUIL_ARTICLES + 1 - etat.count;
    return { erreur: [403, `Publiez encore ${manquants} article(s) (plus de ${SEUIL_ARTICLES} au total) pour activer votre espace boutique.`] };
  }
  const ligne = await ligneAcces(supabaseAdmin, nomCle);
  if (!ligne) {
    return { erreur: [403, "Votre espace boutique n'est pas encore actif. Vérifiez le nom et le numéro utilisés à la publication."] };
  }
  const numeroDemande = normalizeMaliPhone(body.telephone);
  if (!numeroDemande || numeroDemande !== etat.telephone) {
    return { erreur: [403, "Numéro non reconnu. Réessayez avec le numéro utilisé lors de la publication."] };
  }
  return { nomCle, etat, ligne };
}

/* Le serveur refuse toute demande qui contient un numéro de boutique
   (champ « telephone_boutique ») : le numéro reste verrouillé. */
function numeroBoutiqueVerrouille(body: Record<string, unknown>): boolean {
  return body.telephone_boutique !== undefined;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "Méthode non autorisée" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(req, { error: "Configuration serveur incomplète" }, 500);
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    const action = text(body.action, 40);
    if (!action) return jsonResponse(req, { error: "Action manquante" }, 400);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    /* -------------------- 1. ACTIVATION (seuil > 5 articles) -------------------- */
    if (action === "activer-si-eligible") {
      const nomCle = canonBoutique(body.nom_boutique);
      if (!nomCle) return jsonResponse(req, { eligible: false, message: "Nom de boutique manquant" });
      const etat = await etatBoutique(supabaseAdmin, nomCle);
      if (!etat) {
        return jsonResponse(req, { eligible: false, message: "Aucune boutique ne porte ce nom. Vérifiez l'orthographe exacte affichée sur le site." });
      }
      if (etat.count === 0) {
        await effacerEnregistrement(supabaseAdmin, nomCle);
        return jsonResponse(req, { eligible: false, message: "Votre boutique n'a plus d'articles publiés : l'accès est désactivé." });
      }
      if (etat.count <= SEUIL_ARTICLES) {
        const manquants = SEUIL_ARTICLES + 1 - etat.count;
        return jsonResponse(req, { eligible: false, message: `Publiez encore ${manquants} article(s) (plus de ${SEUIL_ARTICLES} au total) pour activer votre espace boutique.` });
      }
      /* Le seuil est franchi : l'appareil doit présenter le numéro réellement
         utilisé lors de la publication. À ce moment-là — et SEULEMENT là — le
         numéro du boutiquier est ENREGISTRÉ en base. */
      const numeroDemande = normalizeMaliPhone(body.telephone);
      if (!numeroDemande || numeroDemande !== etat.telephone) {
        return jsonResponse(req, { eligible: false, message: "Nom ou numéro non reconnu. Saisissez le numéro utilisé lors de la publication des articles." });
      }
      const ligne = {
        nom_cle: nomCle,
        nom_affiche: etat.nomAffiche,
        telephone_boutique: etat.telephone,
        maj_le: new Date().toISOString(),
      };
      const { error } = await supabaseAdmin
        .from("acces_boutiquiers")
        .upsert(ligne, { onConflict: "nom_cle" });
      if (error) throw new Error("Enregistrement impossible");
      return jsonResponse(req, {
        eligible: true,
        nom_affiche: etat.nomAffiche,
        telephone_masque: masquerTelephone(etat.telephone),
      });
    }

    /* -------------------- 2. MES ARTICLES -------------------- */
    if (action === "mes-produits") {
      const auth = await authentifierBoutique(supabaseAdmin, body);
      if ("erreur" in auth) return jsonResponse(req, { error: auth.erreur[1] }, auth.erreur[0]);
      const { data, error } = await supabaseAdmin
        .from("produits")
        .select("id, nom, prix, image_url, categorie_id, sous_categorie_id, masque, telephone_boutique, nom_boutique")
        .order("created_at", { ascending: false })
        .limit(1_000);
      if (error) return jsonResponse(req, { error: "Catalogue indisponible" }, 500);
      const mes = (data || [])
        .map((p) => p as unknown as Record<string, unknown>)
        .filter((p) => canonBoutique(p.nom_boutique) === auth.nomCle);
      return jsonResponse(req, {
        success: true,
        nom_affiche: auth.etat.nomAffiche,
        telephone_masque: masquerTelephone(String((auth.ligne as { telephone_boutique?: string }).telephone_boutique || auth.etat.telephone)),
        produits: mes.map((p) => ({
          id: p.id,
          nom: p.nom,
          prix: p.prix,
          image_url: p.image_url,
          categorie_id: p.categorie_id,
          sous_categorie_id: p.sous_categorie_id,
          masque: p.masque,
        })),
      });
    }

    /* -------------------- 3. MODIFIER UN ARTICLE (nom et/ou prix) -------------------- */
    if (action === "modifier-produit") {
      if (numeroBoutiqueVerrouille(body)) {
        return jsonResponse(req, { error: "🔒 Le numéro de la boutique est verrouillé — il ne peut pas être modifié" }, 403);
      }
      const nomCle = canonBoutique(body.nom_boutique);
      if (!nomCle) return jsonResponse(req, { error: "Nom de boutique manquant" }, 400);
      // Cette pré-lecture sert uniquement à déterminer l'id avant l'appel à
      // authentifierBoutique (qui lit elle-même le catalogue).
      const auth = await authentifierBoutique(supabaseAdmin, body);
      if ("erreur" in auth) return jsonResponse(req, { error: auth.erreur[1] }, auth.erreur[0]);

      const { data: tous, error: erreurLecture } = await supabaseAdmin
        .from("produits")
        .select("id, nom, prix, nom_boutique")
        .order("created_at", { ascending: false })
        .limit(1_000);
      if (erreurLecture) return jsonResponse(req, { error: "Catalogue indisponible" }, 500);
      const produit = (tous || [])
        .map((p) => p as unknown as Record<string, unknown>)
        .find((p) => Number(p.id) === Number(body.id) && canonBoutique(p.nom_boutique) === auth.nomCle);
      if (!produit) return jsonResponse(req, { error: "Article introuvable dans votre boutique" }, 404);

      const changements: Record<string, unknown> = {};
      const nouveauNom = text(body.nom, 160);
      if (nouveauNom) {
        if (nouveauNom.length < 2) return jsonResponse(req, { error: "Le nom de l'article doit contenir au moins 2 caractères" }, 400);
        changements.nom = nouveauNom;
      }
      if (body.prix !== undefined && body.prix !== null && body.prix !== "") {
        const nouveauPrix = Math.round(Number(body.prix));
        if (!Number.isFinite(nouveauPrix) || nouveauPrix < PRIX_MINIMUM) {
          return jsonResponse(req, { error: `Prix minimum ${PRIX_MINIMUM.toLocaleString("fr-FR")} FCFA` }, 400);
        }
        changements.prix = nouveauPrix;
      }
      if (Object.keys(changements).length === 0) {
        return jsonResponse(req, { error: "Rien à enregistrer — saisissez un nouveau nom ou un nouveau prix" }, 400);
      }
      const { data: misAJour, error: erreurUpdate } = await supabaseAdmin
        .from("produits")
        .update(changements)
        .eq("id", Number(produit.id) as number)
        .select("id, nom, prix")
        .single();
      if (erreurUpdate) return jsonResponse(req, { error: "Enregistrement impossible : " + erreurUpdate.message }, 500);
      return jsonResponse(req, { success: true, produit: misAJour });
    }

    /* -------------------- 4. ADMIN : PANNEAU (liste d'une boutique) -------------------- */
    if (action === "admin-panneau") {
      const denied = await requireAdmin(req);
      if (denied) return denied;
      const nomDemande = canonBoutique(body.nom_boutique);
      const { data, error } = await supabaseAdmin
        .from("produits")
        .select("id, nom, prix, image_url, categorie_id, sous_categorie_id, masque, nom_boutique, telephone_boutique, telephone")
        .order("created_at", { ascending: false })
        .limit(1_000);
      if (error) return jsonResponse(req, { error: "Catalogue indisponible" }, 500);
      const lignes = (data || []) as Record<string, unknown>[];
      /* Sans nom → liste récapitulative de toutes les boutiques (pour le
         choix dans l'admin) ; avec nom → la boutique précise. */
      if (!nomDemande) {
        const groupes = new Map<string, { nom_affiche: string; telephone: string; count: number }>();
        for (const ligne of lignes) {
          const cle = canonBoutique(ligne.nom_boutique);
          if (!cle) continue;
          const existant = groupes.get(cle) || {
            nom_affiche: text(ligne.nom_boutique, 160),
            telephone: "",
            count: 0,
          };
          existant.count++;
          if (!existant.telephone) {
            const candidat = normalizeMaliPhone((ligne.telephone_boutique as string) || (ligne.telephone as string) || "");
            if (candidat) existant.telephone = candidat;
          }
          groupes.set(cle, existant);
        }
        const boutiques = [...groupes.entries()]
          .map(([cle, valeur]) => ({ nom_cle: cle, ...valeur, telephone_masque: masquerTelephone(valeur.telephone) }))
          .sort((a, b) => b.count - a.count || a.nom_affiche.localeCompare(b.nom_affiche, "fr"));
        return jsonResponse(req, { success: true, boutiques });
      }
      const produits = lignes.filter((p) => canonBoutique(p.nom_boutique) === nomDemande);
      if (produits.length === 0) return jsonResponse(req, { error: "Aucune boutique ne porte ce nom." }, 404);
      const ligneEnregistrement = await ligneAcces(supabaseAdmin, nomDemande);
      const numeroCommission = produits.find((p) => (p.telephone_boutique as string) || (p.telephone as string));
      const numero = normalizeMaliPhone(
        String((numeroCommission as Record<string, unknown> | undefined)?.telephone_boutique || (numeroCommission as Record<string, unknown> | undefined)?.telephone || ""),
      );
      return jsonResponse(req, {
        success: true,
        nom_affiche: text((produits[0] as Record<string, unknown>).nom_boutique, 160),
        telephone_masque: numero ? masquerTelephone(numero) : "—",
        session_active: !!ligneEnregistrement,
        produits: produits.map((p) => ({
          id: p.id,
          nom: p.nom,
          prix: p.prix,
          image_url: p.image_url,
          categorie_id: p.categorie_id,
          sous_categorie_id: p.sous_categorie_id,
          masque: p.masque,
        })),
      });
    }

    /* -------------------- 5. ADMIN : MODIFIER UN ARTICLE -------------------- */
    if (action === "admin-modifier") {
      const denied = await requireAdmin(req);
      if (denied) return denied;
      if (numeroBoutiqueVerrouille(body)) {
        return jsonResponse(req, { error: "🔒 Le numéro de la boutique est verrouillé — il ne peut pas être modifié" }, 403);
      }
      const id = Number(body.id);
      if (!Number.isFinite(id) || id <= 0) return jsonResponse(req, { error: "Article manquant" }, 400);
      const changements: Record<string, unknown> = {};
      const nouveauNom = text(body.nom, 160);
      if (nouveauNom) {
        if (nouveauNom.length < 2) return jsonResponse(req, { error: "Le nom de l'article doit contenir au moins 2 caractères" }, 400);
        changements.nom = nouveauNom;
      }
      if (body.prix !== undefined && body.prix !== null && body.prix !== "") {
        const nouveauPrix = Math.round(Number(body.prix));
        if (!Number.isFinite(nouveauPrix) || nouveauPrix < PRIX_MINIMUM) {
          return jsonResponse(req, { error: `Prix minimum ${PRIX_MINIMUM.toLocaleString("fr-FR")} FCFA` }, 400);
        }
        changements.prix = nouveauPrix;
      }
      if (Object.keys(changements).length === 0) {
        return jsonResponse(req, { error: "Rien à enregistrer — saisissez un nouveau nom ou un nouveau prix" }, 400);
      }
      const { data: misAJour, error: erreurUpdate } = await supabaseAdmin
        .from("produits")
        .update(changements)
        .eq("id", Number(id) as number)
        .select("id, nom, prix")
        .single();
      if (erreurUpdate) return jsonResponse(req, { error: "Enregistrement impossible : " + erreurUpdate.message }, 500);
      return jsonResponse(req, { success: true, produit: misAJour });
    }

    return jsonResponse(req, { error: "Action inconnue" }, 400);
  } catch (error) {
    console.error("[acces-boutiquier] erreur", error instanceof Error ? error.message : error);
    return jsonResponse(req, { error: "Requête impossible à traiter" }, 500);
  }
});
