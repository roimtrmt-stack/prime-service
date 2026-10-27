import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeMaliPhone, orangeSmsEnabled, sendOrangeSms } from "../_shared/orange-sms.ts";

/* =====================================================================
   ACCÈS « MODE BOUTIQUIER » — espace privé du boutiquier concerné.
   1. « demander-code »   : un code à 6 chiffres part par SMS sur le numéro
      enregistré de la boutique (celui du catalogue, jamais un numéro
      choisi par l'appelant). 1 demande par minute.
   2. « connexion »       : le code bon → jeton de session de 7 jours
      (haché en base ; seul son SHA-256 est stocké).
   3. « mes-produits »    : la liste des SEULES commandes/articles de CETTE boutique.
   4. « modifier-produit »: renommer un article ou changer son prix.
      Rien d'autre : le numéro de la boutique est verrouillé côté serveur
      (toute demande contenant un numéro est refusée) et le serveur refuse
      de toucher à tout autre article que ceux de la boutique du jeton.
   ===================================================================== */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const SITE_ORIGIN = "https://roimtrmt-stack.github.io/prime-service";
const ALLOWED_ORIGINS = new Set([
  "https://roimtrmt-stack.github.io",
  "https://primeservice.netlify.app",
  "http://localhost:4173",
  "http://localhost:5173",
]);

const CODE_LONGUEUR = 6;
const CODE_DUREE_MS = 10 * 60 * 1000;        // 10 minutes
const CODE_DEMANDE_INTERVALLE_MS = 60 * 1000; // 1 minute entre deux codes
const CODE_TENTATIVES_MAX = 5;
const JETON_DUREE_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
const PRIX_MINIMUM = 1000;

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

async function sha256Hex(valeur: string): Promise<string> {
  const octets = new TextEncoder().encode(valeur);
  const empreinte = await crypto.subtle.digest("SHA-256", octets);
  return [...new Uint8Array(empreinte)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function masquerTelephone(phone: string): string {
  const chiffres = phone.replace(/\D/g, ""); // ex 22394134408
  const national = chiffres.slice(-8);
  return `+223 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
}

/* Retrouve la boutique réelle du catalogue : nom canonique + numéro du
   dernier article publié (source de vérité ascendante, comme le site).
   Aucun numéro reçu du navigateur n'est utilisé. */
async function trouverBoutique(
  supabaseAdmin: ReturnType<typeof createClient>,
  nomCle: string,
): Promise<{ nomAffiche: string; telephone: string } | null> {
  const { data, error } = await supabaseAdmin
    .from("produits")
    .select("nom_boutique, telephone_boutique, telephone")
    .order("created_at", { ascending: false })
    .limit(1_000);
  if (error) throw new Error("Catalogue indisponible");
  for (const ligne of data || []) {
    if (canonBoutique((ligne as Record<string, unknown>).nom_boutique) !== nomCle) continue;
    const ligne_ = ligne as Record<string, unknown>;
    const numero = normalizeMaliPhone((ligne_.telephone_boutique as string) || (ligne_.telephone as string) || "");
    if (numero) {
      return { nomAffiche: text(ligne_.nom_boutique, 160), telephone: numero };
    }
  }
  return null;
}

function genererCode(longueur = CODE_LONGUEUR): string {
  const tampon = new Uint32Array(longueur);
  crypto.getRandomValues(tampon);
  return [...tampon].map((x) => x % 10).join("");
}

function genererJeton(): string {
  const octets = new Uint8Array(32);
  crypto.getRandomValues(octets);
  return [...octets].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type LigneAcces = {
  nom_cle: string;
  nom_affiche: string;
  telephone_boutique: string;
  code_hash: string | null;
  code_expires_at: string | null;
  code_tentatives: number;
  token_hash: string | null;
  token_expires_at: string | null;
};

async function ligneParJeton(
  supabaseAdmin: ReturnType<typeof createClient>,
  jeton: string,
): Promise<LigneAcces | null> {
  const jetonPropre = text(jeton, 200);
  if (!jetonPropre) return null;
  const hash = await sha256Hex(jetonPropre);
  const { data, error } = await supabaseAdmin
    .from("acces_boutiquiers")
    .select("*")
    .eq("token_hash", hash)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const ligne = data as unknown as LigneAcces;
  if (!ligne.token_expires_at || new Date(ligne.token_expires_at).getTime() <= Date.now()) return null;
  return ligne;
}

/* Un article appartient-il à la boutique du jeton ? Comparaison canonique,
   même logique que le reste du site (espaces/majuscules tolérés). */
function articleAppartient(
  produits: Array<Record<string, unknown>>,
  nomCle: string,
  idProduit: unknown,
) {
  return produits.find(
    (p) => Number(p.id) === Number(idProduit) && canonBoutique(p.nom_boutique) === nomCle,
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return jsonResponse(req, { error: "Méthode non autorisée" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(req, { error: "Configuration serveur incomplète" }, 500);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = text(body.action, 40);

    /* ---------------- 1. DEMANDER UN CODE SMS ---------------- */
    if (action === "demander-code") {
      const nomCle = canonBoutique(body.nom_boutique);
      if (!nomCle) return jsonResponse(req, { error: "Nom de boutique manquant" }, 400);

      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const boutique = await trouverBoutique(supabaseAdmin, nomCle);
      if (!boutique) {
        return jsonResponse(req, { error: "Aucune boutique ne porte ce nom. Vérifiez l'orthographe exacte affichée sur le site." }, 404);
      }

      const { data: existante } = await supabaseAdmin
        .from("acces_boutiquiers")
        .select("dernier_code_demande_le")
        .eq("nom_cle", nomCle)
        .maybeSingle();
      const demandePrecedente = existante ? (existante as Record<string, unknown>).dernier_code_demande_le as string | null : null;
      if (demandePrecedente && Date.now() - new Date(demandePrecedente).getTime() < CODE_DEMANDE_INTERVALLE_MS) {
        return jsonResponse(req, { error: "Un code vient d'être envoyé. Attendez une minute avant d'en redemander un." }, 429);
      }

      const code = genererCode();
      const codeHash = await sha256Hex(`${code}|${nomCle}`.concat("|prime-service"));
      const maintenant = new Date().toISOString();
      const expirations = new Date(Date.now() + CODE_DUREE_MS).toISOString();

      // Fichier unique : évite tout conflit d'écriture simultanée (cli + cron-like retries).
      const { error: erreurLigne } = await supabaseAdmin
        .from("acces_boutiquiers")
        .upsert({
          nom_cle: nomCle,
          nom_affiche: boutique.nomAffiche,
          telephone_boutique: boutique.telephone,
          code_hash: codeHash,
          code_expires_at: expirations,
          code_tentatives: 0,
          dernier_code_demande_le: maintenant,
          maj_le: maintenant,
        }, { onConflict: "nom_cle" });
      if (erreurLigne) throw new Error("Enregistrement du code impossible");

      if (!orangeSmsEnabled()) {
        return jsonResponse(req, { error: "L'envoi SMS est momentanément indisponible. Contactez Prime Service." }, 503);
      }
      const resultat = await sendOrangeSms(
        boutique.telephone,
        `Prime Service\nCode d'accès boutique : ${code}\nValable 10 minutes. Ne le partagez avec personne.`,
      );
      if (!resultat.delivered) {
        return jsonResponse(req, { error: `Code non envoyé (${resultat.reason}). Contactez Prime Service.` }, 502);
      }

      return jsonResponse(req, {
        success: true,
        telephone_masque: masquerTelephone(boutique.telephone),
        expire_dans_minutes: Math.round(CODE_DUREE_MS / 60000),
      });
    }

    /* ---------------- 2. VÉRIFIER LE CODE → JETON DE SESSION ---------------- */
    if (action === "connexion") {
      const nomCle = canonBoutique(body.nom_boutique);
      const code = text(body.code, 12).replace(/\D/g, "").slice(0, CODE_LONGUEUR);
      if (!nomCle || code.length !== CODE_LONGUEUR) {
        return jsonResponse(req, { error: "Nom de boutique ou code incomplet" }, 400);
      }

      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: ligne } = await supabaseAdmin
        .from("acces_boutiquiers")
        .select("code_hash, code_expires_at, code_tentatives, nom_affiche, telephone_boutique")
        .eq("nom_cle", nomCle)
        .maybeSingle();
      if (!ligne) return jsonResponse(req, { error: "Demandez d'abord un code par SMS" }, 404);

      const l = ligne as unknown as LigneAcces;
      if (l.code_tentatives >= CODE_TENTATIVES_MAX) {
        return jsonResponse(req, { error: "Trop d'essais. Demandez un nouveau code." }, 429);
      }

      const calcule = await sha256Hex(`${code}|${nomCle}`.concat("|prime-service"));
      const expire = !l.code_expires_at || new Date(l.code_expires_at).getTime() <= Date.now();
      if (expire || calcule !== l.code_hash) {
        const tentative = (l.code_tentatives || 0) + 1;
        await supabaseAdmin
          .from("acces_boutiquiers")
          .update({ code_tentatives: tentative })
          .eq("nom_cle", nomCle);
        const restants = CODE_TENTATIVES_MAX - tentative;
        return jsonResponse(req, {
          error: expire
            ? "Code expiré. Demandez un nouveau code."
            : `Code incorrect${restants <= 2 ? ` (${restants} essai(s) restant(s))` : ""}`,
        }, 401);
      }

      const jeton = genererJeton();
      const jetonHash = await sha256Hex(jeton);
      const expireLe = new Date(Date.now() + JETON_DUREE_MS).toISOString();
      const maintenant = new Date().toISOString();
      const { error: erreurJeton } = await supabaseAdmin
        .from("acces_boutiquiers")
        .update({ token_hash: jetonHash, token_expires_at: expireLe, code_hash: null, code_expires_at: null, code_tentatives: 0, maj_le: maintenant })
        .eq("nom_cle", nomCle);
      if (erreurJeton) throw new Error("Session impossible");

      return jsonResponse(req, {
        success: true,
        token: jeton,
        nom_affiche: l.nom_affiche,
        telephone_masque: masquerTelephone(l.telephone_boutique),
        expire_le: expireLe,
      });
    }

    /* ---------------- 3. MES ARTICLES (jeton de session) ---------------- */
    if (action === "mes-produits") {
      const ligne = await ligneParJeton(createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY), text(body.token, 200));
      if (!ligne) return jsonResponse(req, { error: "Session expirée — reconnectez-vous" }, 401);

      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data, error } = await supabaseAdmin
        .from("produits")
        .select("id, nom, prix, image_url, categorie_id, sous_categorie_id, masque, telephone_boutique, nom_boutique")
        .order("created_at", { ascending: false })
        .limit(1_000);
      if (error) return jsonResponse(req, { error: "Catalogue indisponible" }, 500);
      const mes = (data || [])
        .map((p) => p as unknown as Record<string, unknown>)
        .filter((p) => canonBoutique(p.nom_boutique) === ligne.nom_cle);

      return jsonResponse(req, {
        success: true,
        nom_affiche: ligne.nom_affiche,
        telephone_masque: masquerTelephone(ligne.telephone_boutique),
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

    /* ---------------- 4. MODIFIER UN ARTICLE (nom et/ou prix UNIQUEMENT) ---------------- */
    if (action === "modifier-produit") {
      if (body.telephone_boutique !== undefined || body.telephone !== undefined) {
        return jsonResponse(req, { error: "🔒 Le numéro de la boutique est verrouillé — il ne peut pas être modifié" }, 403);
      }
      const nomCle = (await ligneParJeton(createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY), text(body.token, 200)))?.nom_cle
        ?? null;
      if (!nomCle) return jsonResponse(req, { error: "Session expirée — reconnectez-vous" }, 401);

      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: tous, error: erreurLecture } = await supabaseAdmin
        .from("produits")
        .select("id, nom, prix, nom_boutique")
        .order("created_at", { ascending: false })
        .limit(1_000);
      if (erreurLecture) return jsonResponse(req, { error: "Catalogue indisponible" }, 500);
      const produit = articleAppartient((tous || []).map((p) => p as unknown as Record<string, unknown>), nomCle, body.id);
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

    return jsonResponse(req, { error: "Action inconnue" }, 400);
  } catch (error) {
    console.error("[acces-boutiquier] erreur", error instanceof Error ? error.message : error);
    return jsonResponse(req, { error: "Requête impossible à traiter" }, 500);
  }
});
