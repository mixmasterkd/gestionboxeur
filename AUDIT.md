# Audit ciblé — 23 septembre 2026

Périmètre : création du compte athlète de test, boutons sur ordinateur et téléphone. Les corrections et la refonte Arena sont publiées depuis le 23 septembre 2026 (Toronto), avec l'autorisation de l'utilisateur.

| Priorité | Constat | Correction |
| --- | --- | --- |
| Bloquant | La création du compte test génère un mot de passe de 74 caractères. Les journaux Auth du 23 septembre à 23:57 UTC confirment plusieurs refus HTTP 400 : `Password cannot be longer than 72 characters`. Aucun compte test n’existe au moment de l’audit. La fonction distante version 3 contient bien cette expression. | Mot de passe aléatoire de 67 octets ASCII, conservant les deux UUID. Le test simule désormais la limite Auth : il échoue avant le correctif et réussit après. |
| Interface | Sur téléphone, le pied du dialogue de partage hérite de marges latérales de −17 px prévues pour les formulaires, alors qu’il est placé directement dans le dialogue. | Marges remises à zéro pour ce pied uniquement et boutons répartis sur les lignes disponibles. |
| Interface | Les actions du formulaire d’administration sont en flex sans retour à la ligne; les lignes du répertoire des gyms n’ont aucun style dédié. | Retour à la ligne des actions, présentation des gyms avec espacement et bouton Modifier, adresses longues autorisées à se couper. Les boutons et leur compteur gèrent mieux les espaces étroits. |
| Interface publiée | La compilation Vite extrayait le thème partagé dans une feuille chargée avant `app.css` ou `planner.css`. Leurs anciennes règles réécrivaient alors la palette et les boutons malgré le bon ordre dans les HTML sources. | Une seule entrée CSS ordonnée par famille de pages. Contrôle automatique du CSS **compilé** lors de chaque build, sur cinq pages et deux largeurs. |
| Retour utilisateur | Une erreur du compte test apparaît dans la section Membres et peut être effacée par son actualisation. Le bouton désactivé n’explique pas l’action en cours. | Erreur près du bouton de test, libellé de chargement et état accessible `aria-busy`. Un test vérifie les erreurs, les doubles clics et la déconnexion. |

## Vérifications réalisées

- `npm run check` : réussi.
- `npm test` : 241 tests réussis, aucun ignoré, dont ouverture/fermeture de la navigation spatiale, routes selon le rôle et actualisation du menu.
- `npm run build` : réussi. Avertissement de découpage préexistant : `data.js` est importé à la fois statiquement et dynamiquement.
- `git diff --check` : réussi.
- Comparaison des styles calculés avec Happy DOM à 375 et 1280 px : marges du partage mobile de −17 px à 0; actions d’administration avec retour à la ligne; répertoire en grille.
- Lecture du service et des journaux distants; aucune modification de la base, aucun compte créé, aucun courriel envoyé.
- Palette et boutons contrôlés à 320, 375, 768, 1024 et 1440 px sur les sources; contrôle du CSS compilé à 375 et 1280 px. Contraste des principales combinaisons de texte : de 5,28:1 à 14,39:1.

## Publication vérifiée

- Commit applicatif : `025b9e79636041458ab2cf3f0a7b8d9cbe34191c`.
- [Workflow GitHub Pages réussi](https://github.com/mixmasterkd/gestionboxeur/actions/runs/35953117413) : contrôles, tests, build et déploiement.
- [Site public](https://mixmasterkd.github.io/gestionboxeur/) : six pages et douze fichiers CSS/JS répondent en HTTP 200 et sont identiques octet pour octet à l'artefact GitHub Actions.
- Fonction `admin-users` version 4 active; source distante identique au correctif local, `verify_jwt=true`, appel sans authentification refusé en HTTP 401. Version 3 sauvegardée hors du dépôt avant publication. Les huit migrations restent inchangées.
- Interface Arena : vert profond, ivoire et citron; menu Explorer en perspective, cartes mobiles, navigation directe conservée. Animations limitées aux interactions et désactivées avec `prefers-reduced-motion`. Aucune dépendance supplémentaire.

## À valider après publication

La fonction Supabase et GitHub Pages ont été publiés. Un simple push ne déclenche toujours pas le workflow manuel de ce dépôt.

Depuis Administration, ouvrir **Passer en mode athlète de test**, vérifier le calendrier, créer une séance fictive, la marquer faite, puis revenir à l’administration. Refaire l’ouverture pour vérifier la réutilisation du compte et la conservation de la session coach. Tester aussi une séance ajoutée par le coach sur cet athlète et visible côté athlète.

Contrôler visuellement le partage de liste, les formulaires et le répertoire des gyms sur ordinateur et téléphone. Aucun navigateur pilotable n’était disponible pendant l’audit : Happy DOM valide les règles de style et les interactions, pas la géométrie réelle ni le rendu visuel. Le parcours connecté complet reste à confirmer; les tests automatisés ne suffisent pas à l’attester.
