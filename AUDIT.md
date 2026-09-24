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


## Raffinements du 24 septembre 2026

- Palette blanc, graphite et touches corail, conservant les adaptations mobiles et la navigation Explorer.
- Description et notes de séance réunies dans Texte; exemples retirés de la zone de saisie. Vocabulaire Jog. Aide accessible sur demande.
- Zone d’effort sur les étapes, sans sélecteur d’intensité ciblée ni zone ajoutée en double aux nouvelles répétitions. Les anciennes données sont conservées.
- Bibliothèque accessible au premier plan et dans Explorer; création de modèles sans athlète sélectionné. Kit de 13 séances, dont Sparring.
- Discipline Sparring, alias texte Sparing et graphique coloré; cinq couleurs pastel persistantes pour les notes/événements.
- 247 tests réussis, contrôles de syntaxe et build réussis. Tests ajoutés sur les textes de séance, la création sans athlète, les routes de bibliothèque et les couleurs avec permissions/verrous.
- Migration distante `20260924041944_event_pastel_colors` appliquée. Sauvegarde locale hors dépôt avant changement. Une ligne existante; nombre et empreinte de toutes les anciennes colonnes identiques après migration, règles RLS inchangées. Écriture couleur accordée à authenticated sous RLS, refusée à anon; liste des cinq valeurs contrainte côté base.
- Conseils de sécurité distants inchangés : RPC protégées intentionnellement SECURITY DEFINER, invitations accessibles seulement par RPC, protection des mots de passe divulgués toujours désactivée (configuration préexistante). Aucun changement d’Auth pour ces raffinements.
- Limite inchangée : pas de navigateur pilotable disponible pour valider visuellement la géométrie réelle ou le parcours connecté complet.

### Publication des raffinements vérifiée

- Commit applicatif `84d20b3b42180da895790db8bf1b327bfdd27344`.
- [Workflow réussi](https://github.com/mixmasterkd/gestionboxeur/actions/runs/35955285863) : vérifications, 247 tests, build et déploiement.
- Les 18 fichiers publics (6 pages et 12 fichiers CSS/JS) répondent HTTP 200 et correspondent octet pour octet à l’artefact de ce workflow, récupéré après publication.
- La fonction `admin-users` version 4 reste inchangée; neuvième migration distante appliquée pour les couleurs pastel.


## Compte unique · 24 septembre 2026

- Inscription unique, activation des fonctions coach dans Mon profil, calendrier personnel pour les coachs, connexions Mes athlètes / Mes coachs.
- 252 tests réussis; syntaxe et build vérifiés. Nouveaux parcours : coaching entre coachs, absence d’accès transitif aux boxeurs, révocation, conservation d’identité lors de l’activation, refus pour le compte test et les anonymes, navigation entre calendriers, connexions personnelles même si un autre boxeur est sélectionné.
- Migration `20260924131821_unified_accounts` appliquée. Sauvegarde des dix tables concernées et des anciennes fonctions hors dépôt. Toutes les lignes préexistantes sont identiques après migration; seuls deux profils personnels manquants ont été ajoutés (9 à 11 fiches). Trois comptes ont désormais chacun un profil personnel. Le compte test et son rattachement sont conservés.
- `enable_coaching` est intentionnellement une RPC SECURITY DEFINER, limitée à auth.uid(), sans paramètre d’identité, sans modification de is_admin; droits refusés à anon et PUBLIC. L’avis générique correspondant passe de 19 à 20 fonctions. Les autres avis restent inchangés. [Documentation de cet avis](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- Journal et groupes restent en discussion, sans implantation dans cette livraison.

### Publication du compte unique vérifiée

- Commit applicatif `928cee092912366f864ec39ae076e1050ae1a88b`.
- [Workflow réussi](https://github.com/mixmasterkd/gestionboxeur/actions/runs/36004954629) : contrôles, 252 tests, build et déploiement.
- Les 18 fichiers publics correspondent octet pour octet à l’artefact de publication.
- Vérification dans le navigateur connecté : calendrier personnel du coach, ouverture de Mes coachs, passage vers le compte athlète de test existant avec ses séances conservées, puis retour effectif à l’administration. Retour final au calendrier personnel du coach. Aucun contenu d’entraînement modifié pendant ce contrôle.
- Ces vérifications confirment le parcours de bascule précédemment laissé à valider; elles ne remplacent pas une validation visuelle complète sur téléphone.

## Calendrier compact et thème graphite · 24 septembre 2026

- Liste des calendriers déplacée dans une fenêtre de recherche à hauteur limitée. Sélection insensible aux accents, retour au calendrier sans changement de période, fermeture au clavier et restauration du focus.
- Coche de réalisation intégrée à la ligne du titre, visible aussi en vue Mois sur mobile. La réalisation reste réservée au propriétaire du calendrier; détails et autres actions restent accessibles par le titre.
- Palette sombre graphite appliquée aux cinq pages et aux dialogues, avec accents ardoise discrets. Couleurs des efforts et pastels des notes conservés. Impression indépendante et aperçu de feuille blanc lisible.
- 254 tests réussis, dont recherche parmi 30 calendriers et coche mensuelle réversible sans ouverture du détail. Build vérifié sur cinq pages à 375 et 1280 px : palette, contraste des actions, coche mensuelle visible et styles mobiles.
- Navigateur local : aperçu sans écritures distantes; coche réellement actionnée dans une séance fictive en vue Mois à 375 px, détail et formulaire de séance contrôlés, sélecteur fermé/ouvert à 375 et 1280 px. Corrections des anciens fonds blancs des étapes et de textes secondaires peu lisibles.
- Journal et groupes non implantés : journal partagé avec sujets de l’athlète et conseils du coach; proposition À explorer / En travail / À entretenir, sans Acquis. Provenance de groupe par symbole discret, sans étiquette Personnel, à discuter.
- Références consultées : [sélecteur d’athlètes Intervals.icu](https://forum.intervals.icu/t/searching-for-other-athletes/86213), [filtres de calendrier Nolio](https://help.nolio.io/fr/articles/15494320-comment-gerer-les-filtres-du-calendrier). Le sélecteur implémenté est adapté à ce projet.

### Publication graphite vérifiée

- Commit applicatif `d86a37e1de49127e95d2ebd83d20bd5351fd3dd8`; [workflow réussi](https://github.com/mixmasterkd/gestionboxeur/actions/runs/36009785720).
- Les 18 fichiers publics répondent HTTP 200 et correspondent octet pour octet à l’artefact publié.
- Vérification connectée : sélecteur avec calendrier personnel et compte test, palette du calendrier et formulaire du profil. Aucun contenu réel modifié.
- Contrôles supplémentaires à 320 px : pas de débordement horizontal du calendrier; fenêtre de choix contenue dans l’écran. Connexion sombre vérifiée visuellement. Contrastes des principales paires texte/fond : 6,58:1 à 15,1:1.
- Retouche finale `7ac6b9ded79d7013433e88104fed46f67550c36e` : contraste des libellés de compteurs et largeur du champ de recherche. [Publication finale réussie](https://github.com/mixmasterkd/gestionboxeur/actions/runs/36010165819), 254 tests; les 18 fichiers correspondent à son artefact. Couleur des compteurs confirmée dans le navigateur connecté après actualisation.


## 24 septembre 2026 — Journal et bibliothèque par dossiers

- Création de séance en Texte par défaut, bouton à gauche et Programme à droite. Aucun exemple dans la saisie. Retrait du champ Répétitions de mouvement; anciennes données conservées; commandes de déplacement regroupées dans le menu de ligne.
- Bibliothèque : dossiers personnels à créer/renommer, classement des modèles, Jog - Base et Boxe - Base disponibles directement. Retrait du bouton Kit de départ et du menu Explorer.
- Journal séparé des notes : Kanban À explorer / En travail / À entretenir et Chronologie, recherche, sujets de l’athlète ou du coach, conseils attribués, archivage/réactivation. Lecture suivant l’accès au calendrier, contribution du coach suivant son autorisation d’ajout; modification du texte réservée à son auteur.
- Migration distante `20260924143701_journal_and_library_folders.sql` appliquée. Sauvegarde préalable locale privée. Les modèles existants ont été comparés avant/après; séances, notes, athlètes et compte de test conservés. RLS activée, refus des lectures anonymes et de la falsification d’auteur/historique. Journal paginé pour éviter la limite de lecture de 1 000 lignes.
- Conseils de sécurité Supabase inchangés avant/après : une table invitations sans politique (accès RPC intentionnel), 20 fonctions historiques SECURITY DEFINER exposées aux utilisateurs authentifiés, protection des mots de passe divulgués non activée. Aucune nouvelle fonction SECURITY DEFINER exposée; le déclencheur d’historique est privé. Référence : https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- Vérifications locales : création et suivi d’un sujet, historique chronologique, dossiers de base, création/classement dans un dossier personnel, Texte vide par défaut, formulaire d’étape sans répétitions de mouvement. Vue mobile 375 px contrôlée; tests de permissions PostgreSQL isolés.

- Ajouts demandés pendant la vérification : thème clair avec bouton soleil/lune dans toutes les pages et préférence locale; cartes athlètes mobiles compactes, tri compact, nom des athlètes autorisés ouvrant leur calendrier, rattachement déplacé dans le formulaire. Un formulaire modifié doit être enregistré avant comparaison de comptes, pour éviter la perte d’un brouillon.
- Validation finale locale : 260 tests réussis; construction et contrôle des deux palettes sur les cinq pages à 375 et 1280 px. Vérifications visuelles supplémentaires à 320 px; aucun débordement horizontal après correction de la largeur minimale.
- Publication réussie : application `49c2a15`, workflow GitHub Pages `36016205103`. Les 18 fichiers publics correspondent exactement à l’artefact publié, y compris la racine. Vérification connectée : nom de l’athlète de test ouvrant son calendrier; création réelle d’un sujet, ajout d’un conseil, changement de statut et affichage des quatre événements en Chronologie. Le sujet « Vérification du journal » est archivé sur l’athlète de test. Dossier Boxe - Base, emplacement de Rattacher et bascule clair/sombre confirmés sur le site; aucune erreur navigateur observée.
