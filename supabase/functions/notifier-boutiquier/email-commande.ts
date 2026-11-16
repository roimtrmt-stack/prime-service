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
  const lignes = commande.articles.map((article, index) => {
    const montant = Math.round(article.prix * article.quantite).toLocaleString("fr-FR");
    const src = sourceImage(article, index);
    // La photo est affichée en grand, comme la vignette « image » de la
    // notification Chrome, puis le prix et la quantité.
    const photo = src
      ? `<br><img src="${echapperHtml(src)}" alt="${echapperHtml(article.nom)}" style="max-width:100%;width:100%;height:auto;border-radius:12px;margin-top:8px;display:block;">`
      : "";
    return `<li style="margin-bottom:16px;list-style:none;">
      <strong>${echapperHtml(article.nom)}</strong><br>
      <span style="color:#4b5563;">Quantité ${article.quantite} — ${montant} FCFA</span>
      ${photo}
    </li>`;
  }).join("");

  const appel = lienAppelClient(commande.telephone);
  const note = commande.note
    ? `<p style="margin:0 0 14px;padding:10px 12px;background:#fff7ed;border-left:4px solid #f97316;color:#9a3412;font-size:14px;">${echapperHtml(commande.note)}</p>`
    : "";

  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:18px;color:#111827;">
  <h2 style="color:#1d4ed8;margin:0 0 6px;">Nouvelle commande Prime Service</h2>
  <p style="margin:0 0 14px;color:#4b5563;">Commande n° ${echapperHtml(commande.commandeId)} — boutique ${echapperHtml(commande.boutique)}</p>
  ${note}
  <h3 style="margin:14px 0 8px;">Articles à préparer</h3>
  <ul style="padding:0;margin:0 0 14px;">${lignes}</ul>
  <p style="margin:0 0 6px;"><strong>Montant à recevoir du client :</strong> ${Math.round(commande.montant).toLocaleString("fr-FR")} FCFA</p>
  <p style="margin:0 0 6px;"><strong>Client :</strong> ${echapperHtml(commande.client)} — ${echapperHtml(commande.telephone)}</p>
  <p style="margin:0 0 6px;"><strong>Quartier de livraison :</strong> ${echapperHtml(commande.quartier)}</p>
  <p style="margin:0 0 14px;"><strong>Précision :</strong> ${echapperHtml(commande.precision || "aucune")}</p>
  ${commande.mapUrl ? `<p style="margin:0 0 14px;"><a href="${echapperHtml(commande.mapUrl)}" style="color:#1d4ed8;">Voir la position du client</a></p>` : ""}
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0;"><tr>
    ${appel ? `<td style="padding-right:10px;"><a href="${echapperHtml(appel)}" style="display:inline-block;background:#16a34a;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:bold;">📞 Appeler le client</a></td>` : ""}
    <td><a href="${SITE_PRIME_SERVICE}/" style="display:inline-block;background:#1d4ed8;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:bold;">Ouvrir Prime Service</a></td>
  </tr></table>
</div>`;
}

function corpsTexte(commande: CommandeEmail): string {
  const appel = lienAppelClient(commande.telephone);
  return [
    `Nouvelle commande Prime Service — boutique ${commande.boutique}`,
    commande.note ? `(${commande.note})` : "",
    ...commande.articles.map((article) => `- ${article.nom} x${article.quantite} — ${Math.round(article.prix * article.quantite).toLocaleString("fr-FR")} FCFA`),
    `Montant à recevoir du client : ${Math.round(commande.montant).toLocaleString("fr-FR")} FCFA`,
    `Client : ${commande.client} — ${commande.telephone}`,
    appel ? `Appeler le client : ${appel}` : "",
    `Quartier : ${commande.quartier}`,
    commande.precision ? `Précision : ${commande.precision}` : "",
    `${SITE_PRIME_SERVICE}/`,
  ].filter(Boolean).join("\n");
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
