/* Correction photo catalogue locale, gratuite et conservatrice. */
(function(){
  "use strict";

  async function chargerSourcePhoto(fichier){
    if(window.createImageBitmap){
      try {
        return { source: await window.createImageBitmap(fichier, { imageOrientation: "from-image" }), objetBitmap: true, url: "" };
      } catch(e) {
        // Certains navigateurs anciens ne prennent pas en charge imageOrientation.
      }
    }
    const url = URL.createObjectURL(fichier);
    const source = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    return { source, objetBitmap: false, url };
  }

  function limiter(value, min, max){
    return Math.max(min, Math.min(max, value));
  }

  window.optimiserPhotoCatalogueLocalement = async function(fichier, options = {}){
    const tailleMax = Number(options.tailleMax || 1000);
    const qualite = Number(options.qualite || 0.82);
    const chargee = await chargerSourcePhoto(fichier);
    const source = chargee.source;
    try {
      const scale = Math.min(1, 1200 / Math.max(source.width, source.height));
      const width = Math.max(1, Math.round(source.width * scale));
      const height = Math.max(1, Math.round(source.height * scale));
      const travail = document.createElement("canvas");
      travail.width = width;
      travail.height = height;
      const contexteTravail = travail.getContext("2d", { willReadFrequently: true });
      if(!contexteTravail) throw new Error("Canvas indisponible");
      contexteTravail.drawImage(source, 0, 0, width, height);

      const pixels = contexteTravail.getImageData(0, 0, width, height).data;
      const pasBord = Math.max(1, Math.floor(Math.min(width, height) / 100));
      let fondR = 0, fondG = 0, fondB = 0, nombreFond = 0;
      for(let y = 0; y < height; y += pasBord){
        for(let x = 0; x < width; x += pasBord){
          if(x < pasBord * 4 || y < pasBord * 4 || x >= width - pasBord * 4 || y >= height - pasBord * 4){
            const i = (y * width + x) * 4;
            if(pixels[i + 3] > 20){
              fondR += pixels[i]; fondG += pixels[i + 1]; fondB += pixels[i + 2]; nombreFond++;
            }
          }
        }
      }
      const fond = nombreFond
        ? { r: fondR / nombreFond, g: fondG / nombreFond, b: fondB / nombreFond }
        : { r: 244, g: 244, b: 242 };
      const fondLuma = 0.299 * fond.r + 0.587 * fond.g + 0.114 * fond.b;
      const seuil = 42;
      const pasDetection = Math.max(2, Math.floor(Math.min(width, height) / 250));
      const grilleLargeur = Math.ceil(width / pasDetection);
      const grilleHauteur = Math.ceil(height / pasDetection);
      const masque = new Uint8Array(grilleLargeur * grilleHauteur);
      const file = new Int32Array(masque.length);
      const composantes = [];
      const estPremierPlan = (x, y) => {
        const px = Math.min(width - 1, x * pasDetection);
        const py = Math.min(height - 1, y * pasDetection);
        const i = (py * width + px) * 4;
        if(pixels[i + 3] < 20) return false;
        const distance = Math.hypot(pixels[i] - fond.r, pixels[i + 1] - fond.g, pixels[i + 2] - fond.b);
        const pixelLuma = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        return fondLuma >= 150
          ? pixelLuma < fondLuma - 30 || (distance > seuil && pixelLuma < fondLuma - 12)
          : fondLuma <= 105
            ? pixelLuma > fondLuma + 30 || (distance > seuil && pixelLuma > fondLuma + 12)
            : distance > seuil;
      };
      for(let y = 0; y < grilleHauteur; y++){
        for(let x = 0; x < grilleLargeur; x++){
          const debut = y * grilleLargeur + x;
          if(masque[debut] || !estPremierPlan(x, y)) continue;
          masque[debut] = 1;
          let tete = 0, queue = 0, aire = 0, gaucheComp = x, hautComp = y, droiteComp = x, basComp = y;
          file[queue++] = debut;
          while(tete < queue){
            const courant = file[tete++];
            const cx = courant % grilleLargeur;
            const cy = Math.floor(courant / grilleLargeur);
            aire++;
            gaucheComp = Math.min(gaucheComp, cx); hautComp = Math.min(hautComp, cy);
            droiteComp = Math.max(droiteComp, cx); basComp = Math.max(basComp, cy);
            for(let dy = -1; dy <= 1; dy++){
              for(let dx = -1; dx <= 1; dx++){
                if(dx === 0 && dy === 0) continue;
                const nx = cx + dx, ny = cy + dy;
                if(nx < 0 || ny < 0 || nx >= grilleLargeur || ny >= grilleHauteur) continue;
                const suivant = ny * grilleLargeur + nx;
                if(!masque[suivant] && estPremierPlan(nx, ny)){
                  masque[suivant] = 1;
                  file[queue++] = suivant;
                }
              }
            }
          }
          composantes.push({ aire, gauche: gaucheComp, haut: hautComp, droite: droiteComp, bas: basComp });
        }
      }
      const plusGrandeAire = composantes.reduce((max, composante) => Math.max(max, composante.aire), 0);
      const aireMinimale = Math.max(12, Math.floor(plusGrandeAire * 0.04));
      const retenues = composantes.filter((composante) => composante.aire >= aireMinimale);
      let gauche, haut, droite, bas;
      if(!retenues.length){
        gauche = 0; haut = 0; droite = width - 1; bas = height - 1;
      } else {
        const limites = retenues.reduce((acc, composante) => ({
          gauche: Math.min(acc.gauche, composante.gauche), haut: Math.min(acc.haut, composante.haut),
          droite: Math.max(acc.droite, composante.droite), bas: Math.max(acc.bas, composante.bas),
        }), { gauche: grilleLargeur, haut: grilleHauteur, droite: 0, bas: 0 });
        gauche = limites.gauche * pasDetection;
        haut = limites.haut * pasDetection;
        droite = Math.min(width - 1, (limites.droite + 1) * pasDetection - 1);
        bas = Math.min(height - 1, (limites.bas + 1) * pasDetection - 1);
        if(droite - gauche + 1 < width * 0.08 || bas - haut + 1 < height * 0.08){
          gauche = 0; haut = 0; droite = width - 1; bas = height - 1;
        }
      }
      const largeurSujet = droite - gauche + 1;
      const hauteurSujet = bas - haut + 1;
      const margeX = Math.max(8, Math.round(largeurSujet * 0.10));
      const margeY = Math.max(8, Math.round(hauteurSujet * 0.10));
      gauche = Math.max(0, gauche - margeX); haut = Math.max(0, haut - margeY);
      droite = Math.min(width - 1, droite + margeX); bas = Math.min(height - 1, bas + margeY);
      const largeurCadre = droite - gauche + 1;
      const hauteurCadre = bas - haut + 1;

      const sortie = document.createElement("canvas");
      sortie.width = tailleMax;
      sortie.height = tailleMax;
      const contexteSortie = sortie.getContext("2d");
      if(!contexteSortie) throw new Error("Canvas de sortie indisponible");
      const fondSortie = `rgb(${Math.round(limiter(fond.r, 225, 252))}, ${Math.round(limiter(fond.g, 225, 252))}, ${Math.round(limiter(fond.b, 225, 252))})`;
      contexteSortie.fillStyle = fondSortie;
      contexteSortie.fillRect(0, 0, tailleMax, tailleMax);
      const zone = Math.round(tailleMax * 0.90);
      const echelleSortie = Math.min(zone / largeurCadre, zone / hauteurCadre);
      const largeurSortie = Math.max(1, Math.round(largeurCadre * echelleSortie));
      const hauteurSortie = Math.max(1, Math.round(hauteurCadre * echelleSortie));
      contexteSortie.drawImage(travail, gauche, haut, largeurCadre, hauteurCadre, Math.round((tailleMax - largeurSortie) / 2), Math.round((tailleMax - hauteurSortie) / 2), largeurSortie, hauteurSortie);
      return await new Promise((resolve, reject) => {
        sortie.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Correction photo impossible")), "image/jpeg", qualite);
      });
    } finally {
      if(chargee.objetBitmap && typeof source.close === "function") source.close();
      if(chargee.url) URL.revokeObjectURL(chargee.url);
    }
  };
})();
