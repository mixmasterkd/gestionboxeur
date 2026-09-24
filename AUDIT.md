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


## 24 septembre 2026 — Déplacement du journal et lisibilité des listes

- Kanban : glisser-déposer par poignée entre À explorer / En travail / À entretenir, avec Sortable déjà utilisé par le calendrier. Le changement est enregistré et historisé; le détail reste accessible au clavier. Désactivé pour les archives et la consultation seule. Retour à la colonne initiale si la sauvegarde échoue et protection contre un changement d’athlète pendant le déplacement.
- Liste : Sparring en premier et sélectionné à chaque ouverture; type et poids partagent le même contrôle avec aria-pressed, fond contrasté et coche. Correction des contacts coachs auparavant clairs sur fond blanc en thème sombre.
- Entraînement : vues Texte et Blocs sous le titre Entraînement, en remplacement de Programme comme nom de vue.
- Validation : 265 tests réussis, dont déplacement enregistré, échec avec restauration et droits/contexte. Styles compilés des contacts et sélections contrôlés dans les deux thèmes; déplacement réel vérifié dans l’aperçu local.
- Publication : application `3448b58`, workflow `36018909299` réussi. Les 18 fichiers publics correspondent à l’artefact publié. Contrôle connecté : Sparring par défaut, sélection du poids et contraste des contacts, vues Texte / Blocs confirmés. Le formulaire déjà ouvert par l’utilisateur a été conservé intact.


## 24 septembre 2026 — Navigation et vues du répertoire

- Accueil et connexion ouvrent le calendrier; menu Calendrier, Journal, Mes athlètes. Le répertoire est désormais dans roster.html, avec compatibilité des anciens liens de listes et conservation des invitations.
- Tableau par défaut et Fiches au choix sur mobile et ordinateur; données, filtres, sélection et tri partagés. Tableau mobile à défilement horizontal avec nom fixe. Séparation visuelle des filtres, commandes et lignes.
- Boutons alignés, cibles principales de 44 px, motif neutre adapté aux deux thèmes. Champ Texte corrigé pour suivre le thème sombre. Paramètres et À jour retirés du haut du répertoire; réglages dans Mon profil.
- Administration : Fonctions coach activées / non activées remplace les rôles exclusifs Coach / Athlète. Aucune modification des autorisations ni des données.
- Validation : 271 tests réussis; build et styles compilés contrôlés à 375 et 1280 px dans les deux thèmes. Aperçu local interactif : tableaux et fiches, sélection conservée, contrôles et formulaire mobile. Aucun débordement horizontal de page observé.
- Publication réussie : application `8d38de4`, workflow `36022228438`. Les 18 fichiers publics correspondent exactement à l’artefact publié. Vérification connectée : la racine ouvre Mon calendrier; l’administration affiche Fonctions coach avec Activées / Non activées; le répertoire ouvre Tableau et passe en Fiches. Le formulaire déjà ouvert par l’utilisateur a été conservé.


## 24 septembre 2026 — Répétitions libres et panneau d’actions

- Le formulaire de répétition commence par le nombre et le type commun ou Hybride. Lignes ajoutables, réordonnables et supprimables, durée/distance et zone sur chaque ligne; toute la séquence est répétée. Aucune paire effort/récupération imposée ni zone dupliquée sur le groupe. Édition atomique avec annulation; anciens rounds, quantités mixtes, blocs imbriqués et données avancées conservés.
- Types regroupés par optgroup non sélectionnable. Ajout de Jog, Corde à danser, Speed ball, Double end bag et Burpees, avec libellés texte et couleurs de graphique. Les alias historiques Corde restent compatibles.
- Actions du calendrier dans un panneau à cellules égales, icônes discrètes et motif neutre du menu dans les deux thèmes. Logo conservé en attente de discussion.
- Validation : 275 tests réussis; styles compilés et structure vérifiés. Pyramide réelle dans l’aperçu local : 5 × (2 min Z2 + 1 min Z3 + 30 s Z4 + 3 min récupération) = 32 min 30 s, ordre et conversion Texte/Blocs vérifiés. Formulaire contrôlé à 375 px; boutons égaux à 320 et 375 px sans débordement de page.
- Publication réussie : application `5f8238e`, workflow `36025951635`; les 18 fichiers publics correspondent exactement à l’artefact déployé. Vérification connectée : panneau d’actions, création d’une répétition, passage en Hybride et ajout d’une deuxième ligne avec choix de type visible. Aucun enregistrement de séance réelle lors de ce contrôle.


## 24 septembre 2026 — Simplification de l’éditeur

- Choix de calendrier avec icône, recherche encadrée et sélection visible. Menu distinct du fond pointillé : dégradé graphite et lignes obliques, adapté au clair.
- Nom visible des étapes déterminé par leur type; champ Nom uniquement pour Autre. Titres historiques conservés dans les données, avec affichage du type dans les blocs et graphiques.
- Rounds et Répétition ouvrent le même éditeur de séquence; unité configurable et numéros de rounds transmis au graphique. Texte accepte les groupes `3 rounds` avec étapes indentées; anciennes notations conservées. Retrait du choix Effort, repos par case compacte, noms/consignes du groupe remplacés par Notes; annotations historiques préservées.
- Encadré supérieur regroupant titre, discipline, date et verrouillage. Accès unique Bibliothèque avec icône : séances et blocs dans la même fenêtre, ajout des blocs, remplacement confirmé des séances.
- Validation : 278 tests réussis, dont type visible, nom Autre, séquences de rounds, ordre et durées, sécurité d’affichage, bibliothèque commune et conservation du verrouillage/date. Vérifications visuelles locales à 1280, 375 et 320 px; recherche, bibliothèque, rounds et absence de débordement horizontal contrôlés.
- Publication réussie : application `aa885c2`, workflow `36031516383`; les 18 fichiers publics correspondent à l’artefact déployé. Contrôle connecté : encadré de séance avec verrouillage, bibliothèque unique avec icône, bouton Rounds ouvrant une séquence avec unité Rounds et sans champ de nom du groupe. Aucun contenu réel enregistré durant ce contrôle.

## 24 septembre 2026 — Boxe prioritaire et consignes visibles

- Types d’étapes : Boxe avant Course. Nouveaux blocs de rounds limités aux types de boxe et Autre; liste adaptée au changement d’unité, sans conversion silencieuse d’un type incompatible. Anciens blocs conservés à l’édition.
- Étapes seules : Consigne unique, retrait de Plus d’options / Notes. Lignes des répétitions et rounds : Consigne visible sous les mesures, zone facultative et retrait de la case Repos. Contenu historique des notes conservé et présenté dans la consigne; anciennes récupérations préservées.
- Changer sans chevron; initiales sur six couleurs pastel stables selon l’identité de l’athlète. Surface Texte ardoise claire en sombre et ivoire en clair, sans exemple prérempli.
- Validation : 282 tests réussis, vérification de structure et compilation réussies. Contrôles visuels à 375 et 1280 px : consignes des rounds, types disponibles, initiales pastel et contraste du champ Texte dans les deux thèmes.

## 24 septembre 2026 — Bilan visible et réalisation rapide

- Bilan sous le statut de réalisation, dans le même encadré, sans accordéon. RPE de 1 à 10, ressenti et commentaire visibles après réalisation. Enregistrement automatique, état de sauvegarde et nouvelle tentative après erreur; file des dernières modifications et réalisation désactivée durant l’écriture.
- Ressenti sélectionné avec contraste renforcé dans les deux thèmes; choix répartis en trois colonnes sur mobile. Bouton Fait avec cercle / coche, couleur active et libellé au bas des tuiles, y compris en vue mois.
- Validation : 285 tests réussis, structure et build contrôlés. Aperçu fictif : RPE et changements de ressenti enregistrés, commentaire conservé à la réouverture, présentation mobile vérifiée. Aucun bilan réel modifié.

## 24 septembre 2026 — Ajouter une fiche ou inviter un compte existant

- Ajouter un athlète ouvre deux parcours : Inviter un athlète, avec recherche par courriel exact et confirmation explicite d’envoi; Créer une fiche pour le répertoire et les listes. Aucun exemple prérempli. Les invitations en attente sont consultables et annulables depuis ce panneau.
- Le destinataire reçoit un avis sur son calendrier et retrouve la demande dans Mes coachs, avec Accepter / Refuser et une explication des accès. Aucun droit ni relation de suivi avant acceptation; aucune fusion ni recréation du profil. Les permissions d’une relation déjà active restent intactes.
- Nouvelle table protégée par RLS; écritures directes interdites; fonctions publiques sans privilèges élevés, implémentations privées avec vérification du compte. Expiration, envoi idempotent, délai de renvoi après réponse et plafond quotidien. Aucun courriel envoyé par le système : notification dans le site.
- Validation : 289 tests réussis, dont PostgreSQL isolé pour absence d’accès avant acceptation, refus, annulation, expiration, comptes tiers, préservation du calendrier et des accès. Contrôles visuels mobiles du choix et de la recherche sur données fictives. Compilation et structure vérifiées.
- Migration appliquée sur gestionboxeur; requêtes de contrôle des autorisations réussies. Aucune nouvelle alerte Supabase. Alertes antérieures inchangées : anciennes fonctions publiques privilégiées intentionnelles, table historique d’invitations uniquement accessible par fonctions et protection des mots de passe compromis désactivée. Références : https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable et https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.
- Publication finale réussie : application `bcc8776`, workflow `36035627232`. Les 19 fichiers publics correspondent exactement à l’artefact publié. Contrôle connecté du panneau Ajouter un athlète, recherche par courriel sans envoi, ouverture de Créer une fiche et formulaire de rounds avec Consigne visible. Aucun athlète, invitation, bilan ou entraînement réel créé pendant ces contrôles; onglet de travail de l’utilisateur conservé.

## 24 septembre 2026 — Recherche de comptes, coordonnées du gym et affichage mobile

- Invitations : recherche par nom (au moins deux caractères) ou courriel complet, jusqu’à 20 résultats, choix explicite de la personne. Seuls le nom et l’état du lien sont retournés; calendrier inaccessible avant acceptation. Les anciens appels par courriel restent compatibles et utilisent les mêmes règles d’envoi.
- Profil : nom et adresse du gym conservés comme coordonnées propres au coach. Retrait des sélecteurs et du répertoire des gyms dans le profil, l’inscription et l’administration; références historiques préservées. Adresse modifiable dans l’aperçu des listes, au-dessus de sa case d’inclusion; modification limitée à cette liste.
- Mobile : vue Tableau présentée en liste compacte sans défilement horizontal, avec nom, données sportives, statut et commande de modification. Tableau conservé sur ordinateur, vue Fiches disponible partout.
- Calendrier : bouton Fait conservé en semaine et journée, retiré du mois. Indicateur de réalisation et ouverture du bilan par le titre en vue mois.
- Discipline : Boxe en premier et par défaut. Sparring réservé aux exercices de boxe et aux titres libres; anciennes séances lisibles sous Boxe, blocs et titres conservés à l’édition.
- Contacts coachs : proposition discutée, sans implantation : inviter un compte ou créer une fiche, partage du téléphone/courriel au choix du destinataire, indépendant des accès aux calendriers.
- Validation : 290 tests réussis; structure et CSS compilé contrôlés dans les deux thèmes. Vérifications au navigateur sur données fictives à 320, 375 et 1280 px : résultats de recherche, adresse personnalisée, liste compacte et tableau, réalisation depuis le mois, Boxe par défaut et absence de Sparring dans les disciplines. Aucun envoi d’invitation réelle ni modification de profil réel pendant les essais.
- Migration `athlete_name_search_and_gym_coordinates` appliquée; fonctions publiques sans privilèges élevés et inaccessibles anonymement. Aucun nouvel avis Supabase; avis sur les fonctions publiques privilégiées réduit de 20 à 19, autres avis historiques inchangés. Références déjà documentées ci-dessus.
- Publication réussie : application `4044541`, workflow `36043513405`; les 19 fichiers publics correspondent exactement à l’artefact publié. Contrôle connecté : recherche « test » retournant deux comptes avec leurs états distincts, liste portrait sans débordement à 375 px, profil avec uniquement nom/adresse du gym. Aucun envoi ni enregistrement réel; onglet de travail de l’utilisateur conservé.

## 24 septembre 2026 — Profil personnel, sportif et récupération du mot de passe

- Informations personnelles et sportives séparées, chacune avec sa propre sauvegarde et son état de résultat. Pour les coachs, section sportive facultative repliée; coordonnées modifiables même sans date de naissance sportive renseignée. Aucun ajout automatique à un effectif.
- Courriel de contact dans l’identité existante, initialisé avec le courriel du compte en l’absence d’adresse personnalisée. Utilisé pour le premier contact coach dans les listes. Enregistrement limité au profil, sans modification d’Auth; validation de format côté formulaire et serveur.
- Section Mot de passe : lien de réinitialisation envoyé uniquement au courriel du compte, avec retour vers le parcours de récupération existant. Double envoi bloqué, erreur avec nouvelle tentative et nettoyage à la déconnexion. Aucun courriel réel envoyé pendant les essais.
- Validation : 295 tests réussis, dont indépendance des sauvegardes, coach sans date de naissance, conservation des données sportives et du courriel Auth, récupération à l’adresse du compte, erreur/reprise et contact propre au coach. Build et structure vérifiés; contrôle visuel fictif à 375 et 1280 px sans débordement.
- Migration appliquée et autorisations vérifiées : écriture anonyme impossible, mise à jour limitée à son identité. Aucun nouvel avis Supabase; l’ancienne fonction publique privilégiée a été déplacée derrière une entrée sans privilèges élevés (18 avis historiques restants, contre 19). Références de sécurité déjà consignées ci-dessus.
- Publication réussie : application `f7b09f2`, workflow `36046038472`; les 19 fichiers publics correspondent à l’artefact. Profil connecté vérifié : six champs personnels, section sportive repliée, coordonnées et récupération visibles, aucune erreur. Aucun profil réel modifié et aucun lien de réinitialisation réel envoyé.

## 24 septembre 2026 — Logo fourni

- Remplacement de l’ancien symbole du menu par le PNG fourni, conservé sans retouche. Logo également visible en haut à gauche de l’en-tête mobile, avec dimensions fixes pour préserver la mise en page. Chemin adapté aux pages et à l’administration.
- Validation : 295 tests réussis, structure et build vérifiés. Contrôle visuel à 1280 et 375 px, thèmes sombre et clair; aucun changement aux profils ou aux données.
- Publication réussie : application `3908f4a`, workflow `36046693663`; les 20 fichiers publics, dont le logo original, correspondent exactement à l’artefact. Nouveau menu vérifié sur la page publiée après actualisation du cache; ancien symbole absent.

## 24 septembre 2026 — Inscription, en-tête et filtres du journal

- Inscription : téléphone et courriel de contact, avec reprise du courriel du compte si laissé vide. Données sportives facultatives repliées; genre et identité visibles. Validation du contact côté formulaire et serveur, sans modifier l’adresse de connexion.
- En-tête : boutons uniformes de 44 px, Déconnexion avec icône et libellé accessible, présentation compacte sur téléphone; logo et gym alignés avec les commandes.
- Journal : bascule exclusive Actifs / Archives et recherche alignée, conservant les vues Kanban et Chronologie et les restrictions de déplacement des archives.
- Validation : suite de 296 tests réussie, puis test supplémentaire serveur réussi (297 au total); structure et build contrôlés. Vérification mobile au navigateur, sans inscription réelle ni envoi de courriel. Migration signup_contact_details appliquée; avis de sécurité historiques inchangés.
- Publication réussie : application `d8da76b`, workflow `36056248915`; 297 tests validés par la publication. Contrôle visuel complémentaire à 1280 px dans les deux thèmes; inscription et en-tête à 375 px sans débordement.
