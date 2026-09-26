/* Compression photo catalogue locale, gratuite et conservatrice. Le fond d’origine est toujours conservé. */
(function(){
  "use strict";

  async function chargerSourcePhoto(fichier){
    // Sur Safari iOS, createImageBitmap peut échouer ou lever des exceptions de sécurité/état.
    if(window.createImageBitmap){
      try {
        const bmp = await window.createImageBitmap(fichier);
        return { source: bmp, objetBitmap: true, url: "" };
      } catch(e) {
        // Fallback vers Image standard
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
        const largestSide = Math.max(source.width, source.height);
        const scale = Math.min(1, maxDimension / Math.max(1, largestSide));
        const width = Math.max(1, Math.round(source.width * scale));
        const height = Math.max(1, Math.round(source.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if(!context) throw new Error("Canvas indisponible");
        context.drawImage(source, 0, 0, width, height);
        const type = typeSortiePourFichier(fichier);
        return await new Promise((resolve) => {
          canvas.toBlob((blob) => {
            if(blob) resolve(blob);
            else resolve(fichier); // Fallback sans blocage
          }, type, type === "image/jpeg" ? Math.max(0.82, Math.min(0.94, qualite)) : undefined);
        });
      } finally {
        if(chargee.objetBitmap && typeof source.close === "function") source.close();
        if(chargee.url) URL.revokeObjectURL(chargee.url);
      }
    } catch(err) {
      console.warn("Échec compression, utilisation du fichier direct :", err);
      return fichier; // Ne jamais faire échouer l'ajout sur iPhone/Android
    }
  };

  window.optimiserPhotoCatalogueLocalement = window.preparerImageUploadFidele;
  window.extensionImagePreparee = extensionPourType;
})();
