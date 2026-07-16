/* =====================================================================
   CONFIGURATION
   ===================================================================== */
const CONFIG = {
  DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1526939900941828216/dQi_B5P55-8Y5j2yxFo4AxYm1ittk2o5CaNq0JYA97FXU7X8tatWXqmYFP3SW5k8KCgb",
  SUPABASE_URL: "https://kfxalpvbtbvkncztjwzc.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmeGFscHZidGJ2a25jenRqd3pjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNTE2MDgsImV4cCI6MjA5OTcyNzYwOH0.bO1aExLXi1XTCNPMe98h0BFZrOHSM_bII_4WFX5ZPpg",
  NUMERO_PAIEMENT: "94134408",
};

const supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

/* =====================================================================
   TAXONOMIE : CATEGORIES > SOUS-CATEGORIES (fixe, structure du site)
   Les PRODUITS eux-mêmes viennent maintenant de Supabase (permanents,
   visibles par tous les clients, ajoutables depuis l'espace vendeur).
   ===================================================================== */
const CATEGORIES = [
  {
    id: "mode", nom: "Vêtements, bijoux & accessoires", icone: "👗",
    sousCategories: [
      { id: "vetements", nom: "Vêtements", icone: "👕" },
      { id: "bijoux", nom: "Bijoux & montres", icone: "📿" },
      { id: "accessoires-mode", nom: "Accessoires", icone: "👜" },
    ]
  },
  {
    id: "electronique", nom: "Appareils électroniques", icone: "📱",
    sousCategories: [
      { id: "telephones", nom: "Téléphones", icone: "📱" },
      { id: "ordinateurs", nom: "Ordinateurs & tablettes", icone: "💻" },
      { id: "montres-connectees", nom: "Montres connectées", icone: "⌚" },
      { id: "accessoires-electroniques", nom: "Accessoires électroniques", icone: "🔌" },
    ]
  },
  {
    id: "alimentation", nom: "Alimentation", icone: "🍎",
    sousCategories: [
      { id: "legumes", nom: "Légumes", icone: "🍅" },
      { id: "fruits", nom: "Fruits", icone: "🍎" },
      { id: "epicerie", nom: "Divers / Épicerie", icone: "🛒" },
    ]
  }
];

/* =====================================================================
   ETAT DE L'APPLICATION
   ===================================================================== */
let panier = [];
let produitsParCle = {}; // ex: "electronique|telephones" -> [ {id, nom, prix, adresse, lat, lng, image_url}, ... ]
let vueEnCours = { nom: "accueil", idCategorie: null, idSousCategorie: null };

function cleSousCategorie(idCategorie, idSousCategorie){
  return `${idCategorie}|${idSousCategorie}`;
}

/* =====================================================================
   CHARGEMENT DES PRODUITS DEPUIS SUPABASE (permanent, pour tout le monde)
   ===================================================================== */
async function chargerProduits(){
  const { data, error } = await supabaseClient.from("produits").select("*").order("created_at");
  if(error){
    console.error("Erreur de chargement des produits :", error);
    return;
  }

  produitsParCle = {};
  data.forEach(p => {
    const cle = cleSousCategorie(p.categorie_id, p.sous_categorie_id);
    if(!produitsParCle[cle]) produitsParCle[cle] = [];
    produitsParCle[cle].push(p);
  });

  construireCategories();

  // Si le client est en train de regarder une sous-catégorie, on rafraîchit sa vue
  if(vueEnCours.nom === "produits"){
    afficherProduits(vueEnCours.idCategorie, vueEnCours.idSousCategorie, false);
  }
  if(vueEnCours.nom === "souscategories"){
    afficherSousCategories(vueEnCours.idCategorie, false);
  }
}

// Mise à jour automatique en direct : si toi ou un autre appareil ajoute un
// article, tous les visiteurs le voient apparaître sans recharger la page.
supabaseClient
  .channel("produits-en-direct")
  .on("postgres_changes", { event: "*", schema: "public", table: "produits" }, chargerProduits)
  .subscribe();

/* =====================================================================
   NAVIGATION
   ===================================================================== */
function cacherToutesLesVues(){
  document.querySelectorAll(".vue").forEach(v => v.style.display = "none");
}

function afficherAccueil(){
  vueEnCours = { nom: "accueil", idCategorie: null, idSousCategorie: null };
  cacherToutesLesVues();
  document.getElementById("vue-accueil").style.display = "block";
  document.getElementById("btnRetour").style.display = "none";
}

function afficherSousCategories(idCategorie, changerVue = true){
  const categorie = CATEGORIES.find(c => c.id === idCategorie);
  if(!categorie) return;
  if(changerVue) vueEnCours = { nom: "souscategories", idCategorie, idSousCategorie: null };

  cacherToutesLesVues();
  document.getElementById("vue-souscategories").style.display = "block";
  document.getElementById("titreSousCategories").textContent = categorie.nom;

  const btnRetour = document.getElementById("btnRetour");
  btnRetour.style.display = "inline-block";
  btnRetour.onclick = afficherAccueil;

  const grille = document.getElementById("grilleSousCategories");
  grille.innerHTML = categorie.sousCategories.map(sc => {
    const nbProduits = (produitsParCle[cleSousCategorie(categorie.id, sc.id)] || []).length;
    return `
    <div class="carte-categorie" onclick="afficherProduits('${categorie.id}', '${sc.id}')">
      <span class="icone">${sc.icone}</span>
      <h3>${sc.nom}</h3>
      <p>${nbProduits} article(s)</p>
    </div>`;
  }).join("");
}

function afficherProduits(idCategorie, idSousCategorie, changerVue = true){
  const categorie = CATEGORIES.find(c => c.id === idCategorie);
  const sousCategorie = categorie.sousCategories.find(sc => sc.id === idSousCategorie);
  if(!sousCategorie) return;
  if(changerVue) vueEnCours = { nom: "produits", idCategorie, idSousCategorie };

  cacherToutesLesVues();
  document.getElementById("vue-produits").style.display = "block";
  document.getElementById("titreProduits").textContent = sousCategorie.nom;

  const btnRetour = document.getElementById("btnRetour");
  btnRetour.style.display = "inline-block";
  btnRetour.onclick = () => afficherSousCategories(idCategorie);

  const produits = produitsParCle[cleSousCategorie(idCategorie, idSousCategorie)] || [];
  const grille = document.getElementById("grilleProduits");

  if(produits.length === 0){
    grille.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:#666;">Aucun article ici pour le moment.</p>`;
    return;
  }

  grille.innerHTML = produits.map((p, index) => `
    <div class="carte-produit">
      ${p.image_url
        ? `<img src="${p.image_url}" alt="${p.nom}" style="width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px;margin-bottom:10px;">`
        : `<span class="icone-produit">📦</span>`}
      <h4>${p.nom}</h4>
      <div class="prix">${Number(p.prix).toLocaleString("fr-FR")} FCFA</div>
      <button class="btn-ajouter" onclick="ajouterAuPanier('${idCategorie}', '${idSousCategorie}', ${index}, event)">
        Ajouter au panier
      </button>
    </div>
  `).join("");
}

function afficherPanier(){
  cacherToutesLesVues();
  document.getElementById("vue-panier").style.display = "block";
  const btnRetour = document.getElementById("btnRetour");
  btnRetour.style.display = "inline-block";
  btnRetour.onclick = afficherAccueil;
  dessinerPanier();
}

function afficherCheckout(){
  if(panier.length === 0) return;
  cacherToutesLesVues();
  document.getElementById("vue-checkout").style.display = "block";
  const btnRetour = document.getElementById("btnRetour");
  btnRetour.style.display = "inline-block";
  btnRetour.onclick = afficherPanier;
  document.getElementById("totalCheckout").textContent = calculerTotal().toLocaleString("fr-FR") + " FCFA";
}

function construireCategories(){
  const grille = document.getElementById("grilleCategories");
  grille.innerHTML = CATEGORIES.map(cat => {
    const nbArticles = cat.sousCategories.reduce((n, sc) => n + (produitsParCle[cleSousCategorie(cat.id, sc.id)] || []).length, 0);
    return `
    <div class="carte-categorie" onclick="afficherSousCategories('${cat.id}')">
      <span class="icone">${cat.icone}</span>
      <h3>${cat.nom}</h3>
      <p>${nbArticles} article(s)</p>
    </div>`;
  }).join("");
}

/* =====================================================================
   PANIER
   ===================================================================== */
function ajouterAuPanier(idCategorie, idSousCategorie, index, event){
  const produit = produitsParCle[cleSousCategorie(idCategorie, idSousCategorie)][index];

  const existant = panier.find(a => a.id === produit.id);
  if(existant){
    existant.quantite += 1;
  } else {
    panier.push({ ...produit, quantite: 1 });
  }
  mettreAJourCompteur();
  animerAjoutPanier(event);
}

/* Petite animation visuelle : le badge du panier rebondit, et le bouton
   cliqué affiche brièvement une confirmation verte. */
function animerAjoutPanier(event){
  const badge = document.getElementById("compteurPanier");
  badge.classList.remove("anime");
  void badge.offsetWidth; // force le redémarrage de l'animation CSS
  badge.classList.add("anime");

  if(event && event.target){
    const bouton = event.target.closest(".btn-ajouter");
    if(bouton){
      const texteOriginal = bouton.textContent;
      bouton.textContent = "✓ Ajouté !";
      bouton.classList.add("confirme");
      setTimeout(() => {
        bouton.textContent = texteOriginal;
        bouton.classList.remove("confirme");
      }, 900);
    }
  }
}

function changerQuantite(index, delta){
  panier[index].quantite += delta;
  if(panier[index].quantite <= 0){
    panier.splice(index, 1);
  }
  dessinerPanier();
  mettreAJourCompteur();
}

function supprimerArticle(index){
  panier.splice(index, 1);
  dessinerPanier();
  mettreAJourCompteur();
}

function calculerTotal(){
  return panier.reduce((total, a) => total + Number(a.prix) * a.quantite, 0);
}

function mettreAJourCompteur(){
  const total = panier.reduce((n, a) => n + a.quantite, 0);
  document.getElementById("compteurPanier").textContent = total;
}

function dessinerPanier(){
  const liste = document.getElementById("listePanier");
  const videMessage = document.getElementById("panierVide");
  const btnValider = document.getElementById("btnValiderPanier");

  if(panier.length === 0){
    liste.innerHTML = "";
    videMessage.style.display = "block";
    btnValider.style.display = "none";
  } else {
    videMessage.style.display = "none";
    btnValider.style.display = "block";
    liste.innerHTML = panier.map((a, index) => `
      <div class="ligne-panier">
        <div class="info-produit">
          ${a.image_url ? `<img src="${a.image_url}" style="width:32px;height:32px;object-fit:cover;border-radius:6px;">` : `<span class="icone-produit">📦</span>`}
          <div>
            <div><strong>${a.nom}</strong></div>
            <div style="font-size:13px;color:#666;">${Number(a.prix).toLocaleString("fr-FR")} FCFA</div>
          </div>
        </div>
        <div class="quantite">
          <button onclick="changerQuantite(${index}, -1)">−</button>
          <span>${a.quantite}</span>
          <button onclick="changerQuantite(${index}, 1)">+</button>
          <button class="btn-supprimer" onclick="supprimerArticle(${index})">Retirer</button>
        </div>
      </div>
    `).join("");
  }

  document.getElementById("totalPanier").textContent = calculerTotal().toLocaleString("fr-FR") + " FCFA";
}

/* =====================================================================
   GEOLOCALISATION DU CLIENT (obligatoire avant l'envoi)
   ===================================================================== */
function recupererPosition(){
  const statut = document.getElementById("statutPosition");

  if(!navigator.geolocation){
    statut.textContent = "❌ Votre navigateur ne supporte pas la géolocalisation.";
    return;
  }

  statut.textContent = "📡 Recherche de votre position...";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      document.getElementById("latClient").value = position.coords.latitude;
      document.getElementById("lngClient").value = position.coords.longitude;
      statut.textContent = "✅ Position récupérée avec succès.";
      statut.style.color = "#16a34a";
    },
    () => {
      statut.textContent = "❌ Impossible de récupérer votre position. Activez votre GPS et réessayez.";
      statut.style.color = "#dc2626";
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

/* =====================================================================
   ENVOI DE LA COMMANDE VERS DISCORD
   ===================================================================== */
async function envoyerCommande(event){
  event.preventDefault();

  const nom = document.getElementById("nomClient").value.trim();
  const tel = document.getElementById("telClient").value.trim();
  const paiement = document.getElementById("paiementClient").value;
  const lat = document.getElementById("latClient").value;
  const lng = document.getElementById("lngClient").value;
  const statutEnvoi = document.getElementById("statutEnvoi");
  const btnEnvoyer = document.getElementById("btnEnvoyer");

  if(!lat || !lng){
    statutEnvoi.style.color = "#dc2626";
    statutEnvoi.textContent = "⚠️ Merci de récupérer votre position avant de valider.";
    return false;
  }

  if(panier.length === 0){
    statutEnvoi.style.color = "#dc2626";
    statutEnvoi.textContent = "⚠️ Votre panier est vide.";
    return false;
  }

  const lienPositionClient = `https://www.google.com/maps?q=${lat},${lng}`;

  let texte = `🛒 **NOUVELLE COMMANDE — Prime Service**\n\n`;
  texte += `👤 Client : ${nom}\n`;
  texte += `📞 Téléphone : ${tel}\n`;
  texte += `💳 Paiement souhaité : ${paiement}\n`;
  texte += `📍 Position du client : ${lienPositionClient}\n\n`;
  texte += `**Articles commandés :**\n`;

  panier.forEach(a => {
    const lienBoutique = `https://www.google.com/maps?q=${a.lat},${a.lng}`;
    texte += `\n▪️ **${a.nom}** x${a.quantite} — ${(Number(a.prix) * a.quantite).toLocaleString("fr-FR")} FCFA\n`;
    texte += `   🏪 Adresse boutique : ${a.adresse}\n`;
    texte += `   🗺️ Localisation boutique : ${lienBoutique}\n`;
  });

  texte += `\n💰 **Total : ${calculerTotal().toLocaleString("fr-FR")} FCFA**`;

  const premierAvecImage = panier.find(a => a.image_url);
  const corpsRequete = {
    content: texte,
    embeds: premierAvecImage ? [{ image: { url: premierAvecImage.image_url } }] : []
  };

  btnEnvoyer.disabled = true;
  statutEnvoi.style.color = "#555";
  statutEnvoi.textContent = "⏳ Envoi de la commande en cours...";

  try{
    const reponse = await fetch(CONFIG.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpsRequete)
    });

    if(reponse.ok){
      panier = [];
      mettreAJourCompteur();
      afficherPageMerci();
    } else {
      throw new Error("Réponse serveur incorrecte");
    }
  } catch(erreur){
    statutEnvoi.style.color = "#dc2626";
    statutEnvoi.textContent = "❌ Échec de l'envoi. Vérifiez votre connexion et réessayez.";
  } finally {
    btnEnvoyer.disabled = false;
  }

  return false;
}

function afficherPageMerci(){
  cacherToutesLesVues();
  document.getElementById("vue-merci").style.display = "block";
  document.getElementById("btnRetour").style.display = "none";

  const numero = CONFIG.NUMERO_PAIEMENT.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  document.getElementById("numeroPaiementAffiche").textContent = numero;
}

/* =====================================================================
   ESPACE VENDEUR — vraie connexion Supabase (email + mot de passe)
   ===================================================================== */
async function ouvrirEspaceAdmin(){
  cacherToutesLesVues();
  document.getElementById("vue-admin").style.display = "block";
  const btnRetour = document.getElementById("btnRetour");
  btnRetour.style.display = "inline-block";
  btnRetour.onclick = afficherAccueil;

  const { data: { session } } = await supabaseClient.auth.getSession();
  afficherEtatConnexion(!!session);
}

function afficherEtatConnexion(estConnecte){
  document.getElementById("formLoginAdmin").style.display = estConnecte ? "none" : "block";
  document.getElementById("admin-accueil").style.display = estConnecte ? "block" : "none";
  if(!estConnecte) fermerFormulaireArticle();
}

async function connexionAdmin(event){
  event.preventDefault();
  const email = document.getElementById("emailAdmin").value.trim();
  const motDePasse = document.getElementById("motDePasseAdmin").value;
  const statut = document.getElementById("statutConnexion");

  statut.style.color = "#555";
  statut.textContent = "⏳ Connexion...";

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password: motDePasse });

  if(error){
    statut.style.color = "#dc2626";
    statut.textContent = "❌ Email ou mot de passe incorrect.";
    return false;
  }

  statut.textContent = "";
  afficherEtatConnexion(true);
  return false;
}

async function deconnexionAdmin(){
  await supabaseClient.auth.signOut();
  afficherEtatConnexion(false);
}

function ouvrirFormulaireArticle(){
  document.getElementById("admin-accueil").style.display = "none";
  document.getElementById("formArticle").style.display = "block";
  construireCasesACocher();
}

function fermerFormulaireArticle(){
  const formArticle = document.getElementById("formArticle");
  formArticle.style.display = "none";
  formArticle.reset();
  document.getElementById("apercuPhoto").style.display = "none";
  document.getElementById("signePlus").style.display = "block";
  document.getElementById("statutPositionAdmin").textContent = "Position boutique non enregistrée";
  document.getElementById("admin-accueil").style.display = "block";
}

document.addEventListener("click", function(e){
  if(e.target.id === "cadrePhoto" || e.target.id === "signePlus" || e.target.closest("#cadrePhoto")){
    document.getElementById("photoArticle").click();
  }
});

let fichierPhotoSelectionne = null;

function previsualiserPhoto(event){
  const fichier = event.target.files[0];
  if(!fichier) return;
  fichierPhotoSelectionne = fichier;
  const lecteur = new FileReader();
  lecteur.onload = function(e){
    const apercu = document.getElementById("apercuPhoto");
    apercu.src = e.target.result;
    apercu.style.display = "block";
    document.getElementById("signePlus").style.display = "none";
  };
  lecteur.readAsDataURL(fichier);
}

function enregistrerPositionBoutique(){
  const statut = document.getElementById("statutPositionAdmin");
  if(!navigator.geolocation){
    statut.textContent = "❌ Géolocalisation non supportée sur cet appareil.";
    return;
  }
  statut.textContent = "📡 Recherche de la position...";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      document.getElementById("latBoutiqueAdmin").value = position.coords.latitude;
      document.getElementById("lngBoutiqueAdmin").value = position.coords.longitude;
      document.getElementById("adresseBoutiqueAdmin").value =
        `Position GPS : ${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`;
      statut.textContent = "✅ Position de la boutique enregistrée.";
      statut.style.color = "#16a34a";
    },
    () => {
      statut.textContent = "❌ Impossible de récupérer la position. Réessayez devant la boutique.";
      statut.style.color = "#dc2626";
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function construireCasesACocher(){
  const conteneur = document.getElementById("caseACocherSousCategories");
  let html = "";
  CATEGORIES.forEach(cat => {
    cat.sousCategories.forEach(sc => {
      html += `
        <label>
          <input type="checkbox" value="${cat.id}|${sc.id}">
          ${cat.icone} ${cat.nom} → ${sc.icone} ${sc.nom}
        </label>`;
    });
  });
  conteneur.innerHTML = html;
}

async function publierArticle(event){
  event.preventDefault();

  const nom = document.getElementById("nomArticleAdmin").value.trim();
  const prix = parseInt(document.getElementById("prixArticleAdmin").value, 10);
  const adresse = document.getElementById("adresseBoutiqueAdmin").value.trim();
  const lat = parseFloat(document.getElementById("latBoutiqueAdmin").value) || null;
  const lng = parseFloat(document.getElementById("lngBoutiqueAdmin").value) || null;
  const statutPublication = document.getElementById("statutPublication");
  const boutonPublier = event.target.querySelector("button[type=submit]");

  const casesCochees = Array.from(document.querySelectorAll("#caseACocherSousCategories input:checked"));
  if(casesCochees.length === 0){
    statutPublication.style.color = "#dc2626";
    statutPublication.textContent = "⚠️ Choisissez au moins un rayon pour cet article.";
    return false;
  }

  boutonPublier.disabled = true;
  statutPublication.style.color = "#555";
  statutPublication.textContent = "⏳ Publication en cours...";

  try{
    // 1. Upload de la photo (si présente) vers Supabase Storage
    let imageUrl = "";
    if(fichierPhotoSelectionne){
      const cheminFichier = `${Date.now()}-${fichierPhotoSelectionne.name}`;
      const { error: erreurUpload } = await supabaseClient
        .storage
        .from("photos-articles")
        .upload(cheminFichier, fichierPhotoSelectionne);

      if(erreurUpload) throw erreurUpload;

      const { data: donneesPublic } = supabaseClient
        .storage
        .from("photos-articles")
        .getPublicUrl(cheminFichier);

      imageUrl = donneesPublic.publicUrl;
    }

    // 2. Une ligne par rayon coché
    const lignesAInserer = casesCochees.map(caseCochee => {
      const [categorie_id, sous_categorie_id] = caseCochee.value.split("|");
      return { nom, prix, categorie_id, sous_categorie_id, adresse, lat, lng, image_url: imageUrl };
    });

    const { error: erreurInsertion } = await supabaseClient.from("produits").insert(lignesAInserer);
    if(erreurInsertion) throw erreurInsertion;

    statutPublication.style.color = "#16a34a";
    statutPublication.textContent = "✅ Article publié ! Visible immédiatement par tous vos clients.";
    fichierPhotoSelectionne = null;
    setTimeout(fermerFormulaireArticle, 1800);

  } catch(erreur){
    console.error(erreur);
    statutPublication.style.color = "#dc2626";
    statutPublication.textContent = "❌ Erreur lors de la publication. Réessayez.";
  } finally {
    boutonPublier.disabled = false;
  }

  return false;
}

/* =====================================================================
   MODALE "ARTICLE INDISPONIBLE"
   ===================================================================== */
function testerModaleIndisponible(nomArticle){
  document.getElementById("modaleTexte").textContent =
    `Désolé, l'article "${nomArticle}" est fini. Voulez-vous choisir un autre article à la place ?`;
  document.getElementById("modaleIndisponible").style.display = "flex";
}

function fermerModale(choisirAutre){
  document.getElementById("modaleIndisponible").style.display = "none";
  if(choisirAutre){
    afficherAccueil();
  }
}

/* =====================================================================
   DEMARRAGE
   ===================================================================== */
construireCategories();
chargerProduits();
