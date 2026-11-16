/* E-mail de commande destiné au boutiquier.
   Module partagé : une copie identique vit dans chaque fonction qui l'utilise
   (envoyer-commande, notifier-boutiquier). Le workflow et le bundler serveur ne
   résolvent pas les imports hors du dossier d'une fonction, c'est pourquoi le
   fichier est dupliqué — tests/validate-email-module.mjs vérifie que les copies
   restent identiques.

   Les photos des articles sont intégrées au message en pièces jointes « cid: »
   (elles s'affichent donc directement dans Gmail, comme la vignette de la
   notification Chrome), avec repli sur l'URL publique pour Resend et Brevo. */
import nodemailer from "npm:nodemailer@^9";

export const SITE_PRIME_SERVICE = "https://roimtrmt-stack.github.io/prime-service";

const EMAIL_EXPEDITEUR = (Deno.env.get("EMAIL_FROM") || Deno.env.get("BREVO_SENDER_EMAIL") || "").trim();
const EMAIL_NOM_EXPEDITEUR = (Deno.env.get("EMAIL_FROM_NAME") || "Prime Service").trim();
const EMAIL_RESEND_EXPEDITEUR = (Deno.env.get("RESEND_FROM") || "Prime Service <onboarding@resend.dev>").trim();
const TAILLE_MAX_IMAGE = 4 * 1024 * 1024;

export type ArticleEmail = {
  id: number | null;
  nom: string;
  prix: number;
  quantite: number;
  image_url: string | null;
};

export type CommandeEmail = {
  destinataire: string;
  boutique: string;
  commandeId: string;
  articles: ArticleEmail[];
  montant: number;
  client: string;
  telephone: string;
  quartier: string;
  precision: string | null;
  mapUrl: string | null;
  /** Ligne d'explication ajoutée en haut du message (repli push, relance…). */
  note?: string;
};

export type ResultatEmail = {
  destinataire: string;
  envoye: boolean;
  raison: string;
};

function texte(valeur: unknown, max: number): string {
  return typeof valeur === "string" ? valeur.trim().slice(0, max) : "";
}

export function emailValide(valeur: unknown): boolean {
  const brut = texte(valeur, 160);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(brut);
}

function echapperHtml(valeur: unknown): string {
  return texte(valeur, 1_000)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function versBase64(bytes: Uint8Array): string {
  let binaire = "";
  const bloc = 0x8000;
  for (let index = 0; index < bytes.length; index += bloc) {
    binaire += String.fromCharCode(...bytes.subarray(index, index + bloc));
  }
  return btoa(binaire);
}

type ImageIntegree = {
  cid: string;
  filename: string;
  content: string;
  contentType: string;
};

async function telechargerImage(url: string, cid: string): Promise<ImageIntegree | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const minuteur = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > TAILLE_MAX_IMAGE) return null;
    const extension = contentType.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "jpg";
    return {
      cid,
      filename: `${cid}.${extension}`,
      content: versBase64(new Uint8Array(buffer)),
      contentType,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

/* Numéro du client au format international, pour un lien « appeler » qui
   fonctionne depuis Gmail sur téléphone (Mali : +223 + 8 chiffres). */
export function lienAppelClient(telephone: unknown): string | null {
  const chiffres = texte(telephone, 40).replace(/\D/g, "");
  if (chiffres.length === 8) return `tel:+223${chiffres}`;
  if (chiffres.length === 11 && chiffres.startsWith("223")) return `tel:+${chiffres}`;
  if (chiffres.length >= 9 && chiffres.length <= 15) return `tel:+${chiffres}`;
  return null;
}

function corpsHtml(commande: CommandeEmail, sourceImage: (article: ArticleEmail, index: number) => string | null): string {
  const appel = lienAppelClient(commande.telephone);
  const nombre = commande.articles.length;

  const lignes = commande.articles.map((article, index) => {
    const src = sourceImage(article, index);
    const montant = Math.round(article.prix * article.quantite).toLocaleString("fr-FR");
    const vignette = src
      ? `<img src="${echapperHtml(src)}" alt="${echapperHtml(article.nom)}" width="88" style="width:88px;height:88px;object-fit:cover;border-radius:10px;display:block;border:1px solid #e5e7eb;">`
      : `<div style="width:88px;height:88px;border-radius:10px;background:#f1f5f9;color:#94a3b8;font-size:11px;text-align:center;line-height:88px;">sans photo</div>`;
    return `<tr>
          <td width="88" valign="top" style="padding:14px 0;border-bottom:1px solid #eef2f7;">${vignette}</td>
          <td valign="top" style="padding:14px 0 14px 14px;border-bottom:1px solid #eef2f7;">
            <div style="font-size:15px;font-weight:bold;color:#111827;line-height:1.35;">${echapperHtml(article.nom)}</div>
            <div style="font-size:13px;color:#6b7280;margin-top:5px;">Quantité : ${article.quantite}</div>
            <div style="font-size:15px;font-weight:bold;color:#1d4ed8;margin-top:7px;">${montant} FCFA</div>
          </td>
        </tr>`;
  }).join("");

  const note = commande.note
    ? `<div style="background:#fff7ed;border-left:4px solid #f97316;border-radius:8px;padding:11px 13px;margin:0 0 16px;color:#9a3412;font-size:13.5px;line-height:1.5;">${echapperHtml(commande.note)}</div>`
    : "";

  const carteLigne = commande.mapUrl
    ? `<tr><td style="padding:5px 0;font-size:14px;color:#374151;">🗺️ <a href="${echapperHtml(commande.mapUrl)}" style="color:#1d4ed8;text-decoration:none;font-weight:bold;">Voir la position du client</a></td></tr>`
    : "";

  return `<div style="background:#eef2f7;padding:20px 12px;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
    <tr>
      <td style="background:#1d4ed8;padding:18px 22px;">
        <div style="color:#ffffff;font-size:12px;letter-spacing:2.5px;font-weight:bold;">PRIME SERVICE</div>
        <div style="color:#dbeafe;font-size:13px;margin-top:5px;">Nouvelle commande à préparer</div>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 22px 8px;">
        <div style="font-size:14px;color:#6b7280;">Boutique</div>
        <div style="font-size:18px;font-weight:bold;color:#111827;margin-top:3px;">${echapperHtml(commande.boutique)}</div>
        ${note}
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:14px 16px;margin:16px 0 4px;">
          <div style="font-size:11px;letter-spacing:1.2px;font-weight:bold;color:#1e40af;">MONTANT À RECEVOIR DU CLIENT</div>
          <div style="font-size:26px;font-weight:bold;color:#1d4ed8;margin-top:5px;">${Math.round(commande.montant).toLocaleString("fr-FR")} FCFA</div>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 22px 0;">
        <div style="font-size:13px;letter-spacing:1.2px;font-weight:bold;color:#6b7280;text-transform:uppercase;">Articles à préparer (${nombre})</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">${lignes}
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:18px 22px 0;">
        <div style="font-size:13px;letter-spacing:1.2px;font-weight:bold;color:#6b7280;text-transform:uppercase;">Livraison</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
          <tr><td style="padding:5px 0;font-size:14px;color:#374151;">👤 <strong>${echapperHtml(commande.client)}</strong></td></tr>
          <tr><td style="padding:5px 0;font-size:14px;color:#374151;">📞 ${appel ? `<a href="${echapperHtml(appel)}" style="color:#16a34a;text-decoration:none;font-weight:bold;">${echapperHtml(commande.telephone)}</a>` : echapperHtml(commande.telephone)}</td></tr>
          <tr><td style="padding:5px 0;font-size:14px;color:#374151;">📍 ${echapperHtml(commande.quartier)}</td></tr>
          <tr><td style="padding:5px 0;font-size:14px;color:#374151;">🏠 ${echapperHtml(commande.precision || "Aucune précision")}</td></tr>
          ${carteLigne}
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:22px 22px 6px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
          ${appel ? `<td style="padding-right:10px;"><a href="${echapperHtml(appel)}" style="display:block;text-align:center;background:#16a34a;color:#ffffff;padding:14px 18px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;">📞 Appeler le client</a></td>` : ""}
          <td><a href="${SITE_PRIME_SERVICE}/" style="display:block;text-align:center;background:#1d4ed8;color:#ffffff;padding:14px 18px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;">Ouvrir Prime Service</a></td>
        </tr></table>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 22px 22px;">
        <div style="font-size:12px;color:#94a3b8;line-height:1.5;border-top:1px solid #eef2f7;padding-top:12px;">
          Message automatique envoyé par Prime Service au moment de la commande.
        </div>
      </td>
    </tr>
  </table>
</div>`;
}

function corpsTexte(commande: CommandeEmail): string {
  const appel = lienAppelClient(commande.telephone);
  return [
    "PRIME SERVICE — nouvelle commande à préparer",
    `Boutique : ${commande.boutique}`,
    commande.note ? `(${commande.note})` : "",
    "",
    "ARTICLES",
    ...commande.articles.map((article) => `- ${article.nom} x${article.quantite} — ${Math.round(article.prix * article.quantite).toLocaleString("fr-FR")} FCFA`),
    "",
    `MONTANT À RECEVOIR DU CLIENT : ${Math.round(commande.montant).toLocaleString("fr-FR")} FCFA`,
    "",
    "LIVRAISON",
    `Client : ${commande.client}`,
    `Téléphone : ${commande.telephone}`,
    appel ? `Appeler le client : ${appel}` : "",
    `Quartier : ${commande.quartier}`,
    commande.precision ? `Précision : ${commande.precision}` : "",
    commande.mapUrl ? `Position : ${commande.mapUrl}` : "",
    "",
    `${SITE_PRIME_SERVICE}/`,
  ].filter((ligne) => ligne !== "" || true).join("
");
}

function sujet(commande: CommandeEmail): string {
  return `Prime Service - commande ${Math.round(commande.montant).toLocaleString("fr-FR")} FCFA`;
}

async function envoyerViaGmail(
  utilisateur: string,
  motDePasse: string,
  commande: CommandeEmail,
): Promise<ResultatEmail> {
  // Les photos partent en pièces jointes intégrées : Gmail les affiche sans
  // demander « afficher les images », contrairement aux images distantes.
  const images: ImageIntegree[] = [];
  const cidParIndex = new Map<number, string>();
  for (const [index, article] of commande.articles.entries()) {
    if (!article.image_url || images.length >= 6) continue;
    const cid = `article-${article.id ?? "x"}-${index}`;
    const image = await telechargerImage(article.image_url, cid);
    if (!image) continue;
    images.push(image);
    cidParIndex.set(index, `cid:${cid}`);
  }
  const html = corpsHtml(commande, (article, index) => (
    cidParIndex.get(index) || article.image_url || null
  ));

  try {
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: utilisateur, pass: motDePasse },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 25_000,
    });
    await new Promise<void>((resolve, reject) => {
      transport.sendMail({
        from: `Prime Service <${utilisateur}>`,
        to: commande.destinataire,
        subject: sujet(commande),
        text: corpsTexte(commande),
        html,
        attachments: images.map((image) => ({
          filename: image.filename,
          content: image.content,
          encoding: "base64",
          contentType: image.contentType,
          cid: image.cid,
        })),
      }, (error: unknown) => (error ? reject(error) : resolve()));
    });
    return { destinataire: commande.destinataire, envoye: true, raison: `Gmail SMTP (${images.length} photo(s) intégrée(s))` };
  } catch (error) {
    return {
      destinataire: commande.destinataire,
      envoye: false,
      raison: error instanceof Error ? error.message.slice(0, 200) : "erreur SMTP Gmail",
    };
  }
}

async function envoyerViaResend(apiKey: string, commande: CommandeEmail): Promise<ResultatEmail> {
  const html = corpsHtml(commande, (article) => article.image_url);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_RESEND_EXPEDITEUR,
        to: [commande.destinataire],
        subject: sujet(commande),
        html,
        text: corpsTexte(commande),
      }),
    });
    return {
      destinataire: commande.destinataire,
      envoye: response.ok,
      raison: response.ok ? "email accepté par Resend" : `Resend HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      destinataire: commande.destinataire,
      envoye: false,
      raison: error instanceof Error ? error.message.slice(0, 200) : "erreur Resend",
    };
  }
}

async function envoyerViaBrevo(apiKey: string, commande: CommandeEmail): Promise<ResultatEmail> {
  const html = corpsHtml(commande, (article) => article.image_url);
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        sender: { email: EMAIL_EXPEDITEUR, name: EMAIL_NOM_EXPEDITEUR },
        to: [{ email: commande.destinataire }],
        subject: sujet(commande),
        htmlContent: html,
        textContent: corpsTexte(commande),
      }),
    });
    return {
      destinataire: commande.destinataire,
      envoye: response.ok,
      raison: response.ok ? "email accepté par Brevo" : `Brevo HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      destinataire: commande.destinataire,
      envoye: false,
      raison: error instanceof Error ? error.message.slice(0, 200) : "erreur Brevo",
    };
  }
}

/** Envoie l'e-mail de commande au boutiquier. Gmail d'abord, puis Resend, puis Brevo. */
export async function envoyerEmailCommande(commande: CommandeEmail): Promise<ResultatEmail | null> {
  if (!emailValide(commande.destinataire)) return null;
  const destinataire = String(commande.destinataire).trim();
  const complete = { ...commande, destinataire };

  const gmailUtilisateur = texte(Deno.env.get("GMAIL_USER"), 160);
  const gmailMotDePasse = Deno.env.get("GMAIL_APP_PASSWORD") || "";
  if (gmailUtilisateur && gmailMotDePasse) return await envoyerViaGmail(gmailUtilisateur, gmailMotDePasse, complete);

  const resendKey = texte(Deno.env.get("RESEND_API_KEY"), 240);
  if (resendKey) return await envoyerViaResend(resendKey, complete);

  const brevoKey = texte(Deno.env.get("BREVO_API_KEY"), 240);
  if (brevoKey && EMAIL_EXPEDITEUR) return await envoyerViaBrevo(brevoKey, complete);

  return {
    destinataire,
    envoye: false,
    raison: "aucun transport configuré (GMAIL_USER/GMAIL_APP_PASSWORD, RESEND_API_KEY ou BREVO_API_KEY/EMAIL_FROM)",
  };
}
