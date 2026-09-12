# Contrôle visuel local — compression fidèle

La photo de référence 1000×540 est préparée sans recadrage ni canvas carré. La sortie conserve les proportions 1000×540, le produit entier, la composition horizontale, le fond, les ombres et les couleurs visibles. Elle est redimensionnée seulement si sa plus grande dimension dépasse 1 200 px, puis encodée dans un format adapté à la source avec une compression élevée. La sortie testée est décodable et pèse environ 358 Ko.

Un test synthétique avec un fond coloré confirme que les pixels du fond et du sujet sont conservés exactement lorsqu’une source PNG est traitée. Aucun masque, remplissage, blanchiment, détourage, remplacement de décor, correction d’éclairage ou recadrage automatique n’est appliqué.
