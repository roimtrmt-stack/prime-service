/* Compression photo catalogue locale, gratuite et conservatrice. Le fond d’origine est toujours conservé. */
(function(){
  "use strict";

  async function chargerSourcePhoto(fichier){
    // Vérification de sécurité pour createImageBitmap sur Safari iOS / Android
    if(typeof window !== "undefined" && typeof window.createImageBitmap === "function"){
      try {
        const bmp = await window.createImageBitmap(fichier);
        if(bmp && bmp.width > 0 && bmp.height > 0){
          return { source: bmp, objetBitmap: true, url: "" };
        }
      } catch(e) {
        // Fallback transparent vers Image standard
      }
    }
    const url = URL.createObjectURL(fichier);
    const source = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = (e) => reject(e || new Error("Erreur de décodage image"));
      image.src = url;
    });
    return { source, objetBitmap: false, url };
  }

  function typeSortiePourFichier(fichier){
    const type = String(fichier?.type || "").toLowerCase();
    return type === "image/png" || type === "image/webp" ? "image/png" : "image/jpeg";
  }

  function extensionPourType(type){
    return type === "image/png" ? "png" : "jpg";
  }

  window.preparerImageUploadFidele = async function(fichier, options = {}){
    try {
      const maxDimension = Number(options.maxDimension || options.tailleMax || 1200);
      const qualite = Number(options.quality || options.qualite || 0.88);
      const chargee = await chargerSourcePhoto(fichier);
      const source = chargee.source;
      try {
        const w = source.naturalWidth || source.width || 0;
        const h = source.naturalHeight || source.height || 0;
        if(w <= 0 || h <= 0){
          return fichier;
        }
        const largestSide = Math.max(w, h);
        const scale = Math.min(1, maxDimension / Math.max(1, largestSide));
        const width = Math.max(1, Math.round(w * scale));
        const height = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if(!context) return fichier;
        context.drawImage(source, 0, 0, width, height);
        const type = typeSortiePourFichier(fichier);
        return await new Promise((resolve) => {
          canvas.toBlob((blob) => {
            if(blob && blob.size > 0) resolve(blob);
            else resolve(fichier); // Fallback sans blocage
          }, type, type === "image/jpeg" ? Math.max(0.82, Math.min(0.94, qualite)) : undefined);
        });
      } finally {
        if(chargee.objetBitmap && typeof source.close === "function") {
          try { source.close(); } catch(e){}
        }
        if(chargee.url) {
          try { URL.revokeObjectURL(chargee.url); } catch(e){}
        }
      }
    } catch(err) {
      console.warn("Échec compression, conservation du fichier direct :", err);
      return fichier; // Ne jamais faire échouer l'ajout sur iPhone ou Android
    }
  };

  window.optimiserPhotoCatalogueLocalement = window.preparerImageUploadFidele;
  window.extensionImagePreparee = extensionPourType;
})();
