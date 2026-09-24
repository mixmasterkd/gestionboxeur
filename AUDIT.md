# Audit ciblé — 23 septembre 2026

Périmètre : création du compte athlète de test, boutons sur ordinateur et téléphone. Les corrections ci-dessous sont locales, non déployées.

| Priorité | Constat | Correction |
| --- | --- | --- |
| Bloquant | La création du compte test génère un mot de passe de 74 caractères. Les journaux Auth du 23 septembre à 23:57 UTC confirment plusieurs refus HTTP 400 : `Password cannot be longer than 72 characters`. Aucun compte test n’existe au moment de l’audit. La fonction distante version 3 contient bien cette expression. | Mot de passe aléatoire de 67 octets ASCII, conservant les deux UUID. Le test simule désormais la limite Auth : il échoue avant le correctif et réussit après. |
| Interface | Sur téléphone, le pied du dialogue de partage hérite de marges latérales de −17 px prévues pour les formulaires, alors qu’il est placé directement dans le dialogue. | Marges remises à zéro pour ce pied uniquement et boutons répartis sur les lignes disponibles. |
| Interface | Les actions du formulaire d’administration sont en flex sans retour à la ligne; les lignes du répertoire des gyms n’ont aucun style dédié. | Retour à la ligne des actions, présentation des gyms avec espacement et bouton Modifier, adresses longues autorisées à se couper. Les boutons et leur compteur gèrent mieux les espaces étroits. |
| Retour utilisateur | Une erreur du compte test apparaît dans la section Membres et peut être effacée par son actualisation. Le bouton désactivé n’explique pas l’action en cours. | Erreur près du bouton de test, libellé de chargement et état accessible `aria-busy`. Un test vérifie les erreurs, les doubles clics et la déconnexion. |

## Vérifications réalisées

- `npm run check` : réussi.
- `npm test` : 238 tests réussis, aucun ignoré.
- `npm run build` : réussi. Avertissement de découpage préexistant : `data.js` est importé à la fois statiquement et dynamiquement.
- `git diff --check` : réussi.
- Comparaison des styles calculés avec Happy DOM à 375 et 1280 px : marges du partage mobile de −17 px à 0; actions d’administration avec retour à la ligne; répertoire en grille.
- Lecture du service et des journaux distants; aucune modification de la base, aucun compte créé, aucun courriel envoyé.

## À valider après publication

La fonction Supabase `admin-users` doit être redéployée pour débloquer la création réelle. Les changements HTML/CSS/JavaScript demandent aussi une publication GitHub Pages; un simple push ne déclenche pas le workflow de ce dépôt.

Depuis Administration, ouvrir **Passer en mode athlète de test**, vérifier le calendrier, créer une séance fictive, la marquer faite, puis revenir à l’administration. Refaire l’ouverture pour vérifier la réutilisation du compte et la conservation de la session coach. Tester aussi une séance ajoutée par le coach sur cet athlète et visible côté athlète.

Contrôler visuellement le partage de liste, les formulaires et le répertoire des gyms sur ordinateur et téléphone. Aucun navigateur pilotable n’était disponible pendant l’audit : Happy DOM valide les règles de style et les interactions, pas la géométrie réelle ni le rendu visuel. Le parcours connecté complet reste à confirmer; les tests automatisés ne suffisent pas à l’attester.
