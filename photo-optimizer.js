/* Compression photo catalogue locale, gratuite et conservatrice. Le fond d’origine est toujours conservé. */
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

  function typeSortiePourFichier(fichier){
    const type = String(fichier?.type || "").toLowerCase();
    return type === "image/png" || type === "image/webp" ? "image/png" : "image/jpeg";
  }

  function extensionPourType(type){
    return type === "image/png" ? "png" : "jpg";
  }

  window.preparerImageUploadFidele = async function(fichier, options = {}){
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
      // Aucun remplissage, aucune sélection et aucun recadrage : le fond est conservé tel quel.
      context.drawImage(source, 0, 0, width, height);
      const type = typeSortiePourFichier(fichier);
      return await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Compression photo impossible")), type, type === "image/jpeg" ? Math.max(0.82, Math.min(0.94, qualite)) : undefined);
      });
    } finally {
      if(chargee.objetBitmap && typeof source.close === "function") source.close();
      if(chargee.url) URL.revokeObjectURL(chargee.url);
    }
  };

  // Compatibilité avec les pages et intégrations existantes : le nom historique
  // désigne désormais une compression fidèle, sans remplacement du fond.
  window.optimiserPhotoCatalogueLocalement = window.preparerImageUploadFidele;
  window.extensionImagePreparee = extensionPourType;
})();
