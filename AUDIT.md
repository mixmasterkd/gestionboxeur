# Mois mobile et timer de séance — 8 octobre 2026

État : publié le 8 octobre 2026, après autorisation de l’utilisateur, depuis le commit `e7389136c369d1f4faa1bb78baf398f104ab8276`. [Workflow réussi](https://github.com/mixmasterkd/gestionboxeur/actions/runs/37820923843), construction `113461459742`, déploiement `113462930810`. Aucune migration ni écriture dans la base de production.

## Comportement livré

- Le mois jusqu’à 800 px affiche des miniatures cliquables avec les couleurs existantes : titre abrégé, durée ou distance connue et petit profil d’effort quand il reste représentable. Les notes sur plusieurs jours conservent un bandeau continu; au-delà de deux aperçus par journée, « +N » ouvre la journée complète. Le numéro ouvre aussi la journée. Un entraînement ou une note s’ouvre directement sans changer la vue mensuelle.
- Les vues Jour/Semaine et la grille ordinateur gardent leur présentation. Le bouton Timer est ajouté aux cartes habituelles et au détail, hors des miniatures du mois mobile.
- Le lecteur utilise une copie de la programmation de la séance. Le texte source prévaut sur les anciens blocs en cache. Les rounds, groupes et repos conservent leur ordre exact. Aucune étape en distance, répétitions ou sans mesure n’est supprimée ou convertie en durée estimée. Une programmation invalide empêche le démarrage plutôt que de lancer une partie de la séance.
- Démarrer ouvre le plein écran avec les couleurs, les sons et le verrouillage du timer à intervalles existant. Maintien de trois secondes pour déverrouiller; maintien de deux secondes pour terminer une étape libre. Une étape libre affiche le temps écoulé, une étape chronométrée le temps restant. Le total connu est distingué des étapes libres.
- Après le go de simplification, le timer affiche uniquement le temps, la phase effort/repos et la progression. Le détail des exercices et les consignes sont consultables dans la fiche de la séance. Le bouton manuel s’intitule « Terminer l’étape ».
- Sans aucune durée programmée, le lecteur propose Chrono libre par défaut ou Configurer des intervalles. Les durées choisies s’appliquent à sa copie, en conservant exercices et rounds, avec un repos entre efforts sans doublon ni repos final ajouté. Le texte libre propose aussi un nombre d’intervalles. Les valeurs sont bornées, un réglage invalide empêche le démarrage et la réinitialisation permet de modifier les choix après démarrage. Aucun changement n’est enregistré dans la séance ou le timer des outils.
- Les appuis courts, annulations tactiles et relâchements après déplacement des commandes n’avancent ni ne réinitialisent le timer. Un clic synthétique de relâchement pouvait atteindre Pause en paysage; il est désormais intercepté. La même protection couvre le verrouillage de l’outil existant.
- Pause/reprise, réinitialisation, réduction et fermeture fonctionnent. Fermer met en pause et permet de rouvrir la copie dans la même page. Une actualisation de page perd cette progression locale. Les réglages du timer libre et la programmation sauvegardée restent intacts. La fin du timer ne marque pas automatiquement la séance comme faite.
- Déconnexion ou changement de compte détruisent le lecteur, les sons et le maintien d’écran. Un chargement différé ne peut pas ouvrir le timer de l’ancien compte.

## Vérifications

- Choix pour les séances sans durée : **68 tests ciblés** réussis; **12 nouveaux parcours navigateur** sur six formats, ainsi que les 12 parcours existants des timers mixtes et libres, validés. Ordre, rounds, repos explicites, saisies invalides, pause/réouverture, réinitialisation et intégrité du programme vérifiés. Contrôle du lien réseau et des deux thèmes en 320, 390, 844 et 1440 px; compilation et contrôles statiques réussis.
- Simplification du timer : **60 tests ciblés** et **12 parcours navigateur** réussis, incluant les étapes libres, le verrouillage et la conservation des consignes dans la fiche. Aperçu réseau contrôlé en 320, 390, 844 et 1440 px; compilation et vérifications statiques réussies.
- `npm run check` : réussi.
- `npm test` dans le workflow de publication : **744 tests réussis**, zéro échec, dont les permissions et migrations PostgreSQL isolées, le moteur hybride, les anciens rounds, le texte source, les pauses, les appuis longs et les changements de compte.
- `npm run test:e2e` avec Chromium dans le workflow de publication : **77 parcours réussis**, **7 combinaisons volontairement ignorées**, zéro échec. Formats 320×720, 390×844, 844×390, 768×1024, 1024×768 et 1440×900.
- Les parcours navigateur couvrent les aperçus et l’ouverture directe, les notes, la navigation existante, la bibliothèque, le glisser-déposer, le bilan athlète, les entraînements chronométrés/mixtes/libres, les couleurs, les pauses et les maintiens par toucher réel émulé ou souris. Aucun appel d’écriture Supabase inattendu ni erreur JavaScript.
- Contrôle supplémentaire du timer à intervalles existant à 390 et 1440 px : plein écran verrouillé, aucune erreur JavaScript ni débordement.
- `npm run build` : réussi; chemins GitHub Pages, manifeste, icônes et CSS compilé vérifiés. L’avertissement préexistant du module 3D reste présent.
- Captures inspectées pour le mois mobile et les timers portrait/paysage. `git diff --check` réussi.
- Après publication : les **44 fichiers** servis publiquement sont identiques, par SHA-256, à l’artefact GitHub Pages. Contrôle à 390 et 1440 px : accès à la connexion, aperçu de développement inaccessible en production, module public du timer exercé avec des données uniquement en mémoire, configuration d’intervalles et plein écran verrouillé fonctionnels. Aucune erreur JavaScript, ressource manquante ou écriture distante pendant ce contrôle.

La QA utilise Chrome avec émulation des formats et données de démonstration en mémoire; elle ne remplace pas un essai sur téléphone physique ou Safari. Les bips et le maintien d’écran reposent sur les possibilités du navigateur; le plein écran possède un repli CSS. Aucun fonctionnement sonore en arrière-plan ou téléphone verrouillé n’est promis.

---

# Corrections et QA — 7 octobre 2026

État : publication autorisée le 7 octobre 2026. La migration et le frontend sont publiés et vérifiés. Application `7da502e8682ed387342fad3ed24b54c616e4ee14`, [workflow réussi](https://github.com/mixmasterkd/gestionboxeur/actions/runs/37714307895). Une sauvegarde applicative privée précède la migration. Les 204 lignes des 30 tables sont conservées; les écritures d’essai ont été annulées par transaction. Aucun compte réel créé ni paramètre Auth modifié.

## Corrections

| Problème | Résultat |
| --- | --- |
| Ancien profil ou calendrier conservé lors d’un changement de compte dans un autre onglet | Invalidation immédiate des données et lectures en attente, fermeture des dialogues, rechargement vers le bon compte. Les nouvelles sauvegardes de profil, gym et activation coach transmettent aussi le compte attendu au serveur. |
| Une fiche d’effectif périmée pouvait écraser des données plus récentes | Capture des versions au moment d’ouvrir le formulaire; vérification des versions de la fiche et de la relation sous verrou PostgreSQL. Le conflit conserve les saisies et affiche une erreur, puis recharge les données pour la prochaine ouverture. Les cases de sélection récupèrent les nouvelles versions après chaque sauvegarde. |
| Les fiches sans compte refusaient un bilan comprenant un match nul | Même règle que les profils liés : victoires + défaites ≤ combats. Cas 10 combats, 8 victoires, 1 défaite testé. |
| `source-map-js` 1.2.1 signalé vulnérable dans la chaîne de compilation | Dépendance transitive mise à jour en 1.2.2 dans le verrou npm. `npm audit` : 0 vulnérabilité signalée. |
| Mots de passe nouvellement créés ou réinitialisés limités à six caractères minimum | Minimum de douze caractères dans l’interface et la validation JavaScript. Les connexions existantes à six caractères restent acceptées. Le réglage Auth serveur reste à traiter séparément. |
| Quinze horodatages de migrations différaient de ceux du serveur | Renommage local d’après l’historique du projet et correction des références. Vérification binaire : les 26 contenus SQL historiques sont identiques à ceux de HEAD. Aucun historique distant modifié. Le test d’évolution de base applique maintenant les migrations réellement dans l’ordre chronologique. |
| La transition animée entre pages levait `AbortError: Transition was skipped` dans Chrome lors d’une redirection rapide vers la connexion | Retrait de la transition CSS entre documents et de ses animations inutilisées. La redirection conserve son fonctionnement; contrôle de la version publiée sur téléphone et ordinateur. |
| Vue mensuelle illisible et commandes trop petites sur téléphone | Chaque journée ouvre la vue Jour au toucher ou au clavier. Aperçu compact avec nombres de séances et de notes, y compris les notes couvrant plusieurs jours. Poignées tactiles de 36 × 44 px minimum, ouvertures de cartes de 44 px minimum, annonce du changement de période et retour de focus au bouton Jour. |

La nouvelle migration `supabase/migrations/20261008013313_guarded_profile_and_roster_updates.sql` est appliquée et vérifiée sur le projet distant, avant publication du frontend. Les nouveaux endpoints publics sont SECURITY INVOKER; la fonction privilégiée de contrôle de l’effectif est dans `coaching_private`, vérifie l’identité et les droits, et refuse l’accès anonyme. Les fonctions historiques restent disponibles pour les anciennes versions de l’interface.

## Code devenu inutile

Le graphe des imports des sept pages de l’application confirme le retrait de trois composants abandonnés : la classe `BlockEditor` et ses helpers dans `js/editor.js`, le module `js/timer-calendar.js` et l’ancien parseur `js/workout-text.js`. Leurs seuls consommateurs étaient des tests d’anciennes interfaces. Les tests correspondants ont été retirés avec ces fonctionnalités mortes; les tests du lecteur historique ont été conservés et adaptés.

Les styles exclusivement associés à l’ancien éditeur ont été retirés de cinq feuilles CSS, en conservant les sélecteurs partagés encore utilisés. `renderWorkout`, `renderChart`, le lecteur des anciens blocs et l’éditeur courant `program-editor.js` / `workout-document.js` restent présents. Les copies de pages dans le dossier parent ne font pas partie du build et n’ont pas été supprimées.

## Vérifications réalisées

- `npm run check` : syntaxe et structure des pages valides.
- `npm test` : **718 tests réussis**, zéro échec, incluant PostgreSQL isolé avec PGlite, droits entre comptes, versions périmées, UI et données historiques.
- `npm run build` : réussi; chemins GitHub Pages, manifeste, icônes et CSS compilé vérifiés. L’avertissement préexistant sur le module 3D chargé à la demande reste présent.
- `npm audit` : **0 vulnérabilité signalée** au 7 octobre 2026.
- `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` : **47 parcours réussis**, zéro échec. Sept combinaisons sont volontairement ignorées : geste de souris sur les profils tactiles et geste tactile sur les profils ordinateur/paysage.
- `git diff --check` : réussi.

| Format simulé dans Chrome | Taille |
| --- | --- |
| Petit téléphone tactile | 320 × 720 |
| Téléphone tactile | 390 × 844 |
| Téléphone en paysage | 844 × 390 |
| Tablette tactile | 768 × 1024 |
| Portable | 1024 × 768 |
| Ordinateur | 1440 × 900 |

Parcours couverts : navigation Jour/Semaine/Mois, thèmes clair et sombre, changement de période, préférence de vue conservée, ouverture d’une journée au clavier, absence de débordement horizontal des pages et dialogues, ajout/modification/déplacement/suppression d’une note sur plusieurs jours, rédaction d’un entraînement puis déplacement de sa séance, bibliothèque et recherche de modèle avec conservation du jour choisi, réalisation d’une séance verrouillée par l’athlète, sauvegarde et relecture du bilan, note privée absente du calendrier athlète, séparation des groupes et des calendriers individuels, déplacement à la souris et réorganisation par appui prolongé sur téléphone/tablette. Les parcours vérifient aussi l’absence d’erreur JavaScript et de mutation réseau Supabase inattendue.

La suite est conservée dans `e2e/calendar.spec.js` et `playwright.config.js`; le workflow manuel de publication l’exécute avant compilation. Les captures de la vue mensuelle et les traces d’échec sont produites dans `test-results/`, ignoré par Git.

## Mise en ligne et limites

La migration et le frontend sont déployés. Les 718 tests isolés et 47 parcours navigateur ont également réussi dans GitHub Actions. Les 42 fichiers publics répondent en HTTP 200 et leurs SHA-256 sont identiques à l’artefact publié. Les nouvelles fonctions refusent les appels HTTP anonymes (401 / 42501). Les vérifications du site public à 320, 390 et 1440 px confirment la redirection vers la connexion, l’absence de mode de démonstration en production, d’erreur JavaScript et de débordement horizontal. La protection Supabase contre les mots de passe compromis reste désactivée; aucun outil disponible ne l’a modifiée. Elle est proposée avec le forfait Pro ou supérieur, selon la [documentation Supabase](https://supabase.com/docs/guides/auth/password-security). Le contrôle de longueur ajouté dans l’interface ne remplace pas une politique Auth côté serveur.

La QA navigateur utilise les données de démonstration en mémoire et l’émulation Chrome. Elle ne constitue pas un essai sur appareil iPhone/Android physique, Safari ou une session utilisateur de production. Les protections SQL sont testées dans une base isolée reconstruite depuis les migrations, puis sur le serveur avec toutes les écritures d’essai annulées. La pagination des très gros effectifs et les optimisations d’index signalées lors de la revue restent des améliorations distinctes de cette série de corrections.

---

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

## 24 septembre 2026 — Précisions d’inscription et confirmation du mot de passe

- Courriel identifié comme identifiant de connexion à l’inscription; téléphone, combats, victoires et défaites explicitement facultatifs.
- Double saisie du mot de passe, estimation locale de force et indication textuelle de concordance en direct. Une différence bloque la création avant tout appel Auth; la confirmation n’est jamais transmise. Parcours de connexion et de récupération préservés.
- Vérification : suite existante de 297 tests réussie, puis test de concordance supplémentaire et tests Auth réussis (298 au total), build et contrôles de structure réussis. Formulaire vérifié à 375 px, sans création de compte réel ni envoi de courriel.

## 24 septembre 2026 — Identité et actions de l’en-tête

- Nom du compte connecté déplacé sous le logo du menu latéral sur le calendrier et le journal, conservé lors des changements de vue.
- Bouton Coachs et invitations avec icône de personnes et libellé sur ordinateur; icône compacte sur mobile. Boutons d’apparence, d’invitations et de déconnexion regroupés.
- Validation : 298 tests, structure et build réussis; affichage ordinateur et conservation du nom après changement de vue vérifiés au navigateur sur données fictives.
- Publication de l’en-tête réussie : `d653d91`, workflow `36057479486`.

## 24 septembre 2026 — Courriel de contact réservé au profil

- Retrait du deuxième courriel à l’inscription; le courriel du compte initialise automatiquement le contact. Dans le profil : « Modifiable sans changer ton courriel de connexion. »
- Validation : 298 tests, structure et build réussis; le test d’inscription vérifie l’absence du deuxième champ et l’adresse transmise. Aucun changement des identifiants ou des profils existants.

## 24 septembre 2026 — Entraînement texte, outils d’ajout et plan visuel

- Un seul document texte, avec Étape, Répétition, Round et Bibliothèque. Les formulaires insèrent la notation à la position choisie; les disciplines ordonnent les activités. Gras, souligné, quatre couleurs adaptées aux thèmes, annulation et rétablissement. Aucun exemple prérempli; aide détaillée séparée.
- Grammaire : étapes précédées d’un tiret, titres libres, consignes, durées composées et guillemets, minutes `m`, mètres `mtr`, kilomètres. Un seul niveau de groupes, fin à la ligne vide, répétition de toutes les étapes et du dernier repos. Les lignes non reconnues restent enregistrables et le graphique se recalcule sur les étapes valides présentes.
- Efforts : zones, RPE, vert/jaune/rouge, repos/marche/repos actif, BPM et allures. Fourchettes représentées par deux bornes superposées, sans zone intermédiaire. Largeur temporelle ou axe distance pour les séances entièrement en distance; absence de durée explicitée. Aucune intensité physiologique inventée pour les BPM ou allures sans références personnelles.
- Document et marques de mise en forme conservés dans séances, modèles, copies et lecture. Les deux types de comptes utilisent les mêmes outils et leur bibliothèque privée. Rendu par nœuds texte et styles autorisés, sans interpréter le HTML de la saisie. Anciennes séances conservées, notamment les rounds historiques sans dernier repos; conversion refusée si elle modifierait une structure ambiguë.
- Migration `workout_documents` appliquée et vérifiée : deux colonnes JSONB facultatives, validation du document et des positions UTF-16, conservation des politiques RLS et ajout des seules permissions de colonnes nécessaires. Contrôles réels : document valide accepté, plage invalide refusée, aucun accès anonyme. Avis Supabase historiques inchangés, sans nouvel avis (18 fonctions privilégiées, invitation historique protégée sans politique directe, protection des mots de passe compromis désactivée; références déjà consignées ci-dessus).
- Validation finale : 336 tests réussis, dont parseur/efforts, texte enrichi, formulaires, cas historiques, sauvegarde/copie/bibliothèque et PostgreSQL isolé. Vérification de structure, syntaxe, build et CSS réussie. Contrôles navigateur à 375 et 1280 px, sombre et clair; création guidée côté athlète, sauvegarde personnelle en bibliothèque, création libre avec plages, gras/couleur et réouverture vérifiées sur données fictives. Aucun entraînement réel modifié pendant les essais.
- Publication réussie : application `de769cf`, workflow `36069124675`. Les 19 fichiers HTML/CSS/JavaScript publics correspondent exactement à l’artefact GitHub Pages. Le contrôle public redirige correctement vers la connexion en l’absence de session; les parcours authentifiés ont été vérifiés dans l’aperçu fictif. Onglet de travail de l’utilisateur conservé.

## 24 septembre 2026 — Rounds implicites et notes du calendrier

- Groupes naturels reconnus : « Shadow Boxing 3 rounds », « 3 rounds de Shadow », « Jog 3x » et « 3x de Jog ». Les étapes sans activité reprennent celle du groupe; une activité explicite la remplace pour sa ligne. Une ligne vide termine le groupe et son contexte. Les titres ordinaires restent libres. Activités connues également acceptées après une mesure, comme « 30 secondes Burpees ». Aide ajustée sans ajouter d’exemples aux champs.
- Les durées sans effort conservent un repère neutre dans le graphique. Le calcul des documents existants suit désormais le texte dès l’ouverture, y compris les nouvelles formes de groupes; les métadonnées compatibles et les protections des anciennes séances sont conservées.
- Notes : visibilité privée indépendante du verrouillage. Une note privée n’est visible que par son auteur, avec maintien des autorisations du calendrier; un lien coach révoqué ne conserve aucun accès. Icônes accessibles de visibilité et de verrouillage; icône de verrouillage également utilisée pour les séances.
- Glisser-déposer des notes avec déplacement de toute la plage de dates, contrôle des permissions, conflits de sauvegarde et restauration en cas d’erreur. Notes sur plusieurs jours affichées en bandes horizontales avec rangées séparées en cas de chevauchement; coupure aux limites de semaine. En semaine sur téléphone, une fiche affiche clairement toute la plage; la vue mensuelle conserve ses bandes compactes.
- Migration « private_calendar_notes » appliquée et vérifiée : colonne booléenne, politique restrictive et protection du changement de confidentialité par l’auteur. Aucun accès anonyme et aucun nouvel avis Supabase; avis historiques inchangés (18 fonctions privilégiées, table historique protégée sans politique directe, protection des mots de passe compromis désactivée).
- Validation : 362 tests réussis, dont contrôles PostgreSQL de lecture/écriture/déplacement privés, autorisations révoquées, groupes implicites, sauvegarde et données historiques. Structure et build réussis. Contrôles navigateur fictifs à 375 et 1280 px, thèmes clair et sombre : icônes, sauvegarde privée, masquage côté athlète, bandes et chevauchements, déplacement conservant la plage et séance mixte de 11 minutes sauvegardée puis relue. Aucun entraînement ni note réels créés ou modifiés pendant ces essais.
- Première publication réussie : application `e390f68`, workflow `36073328875`; les 19 fichiers HTML/CSS/JavaScript publics correspondent à l’artefact.
- Ajustement demandé pendant la publication : vocabulaire « Notes » dans les boutons, formulaires et permissions; palette intitulée « Couleur », avec cinq cases de 44 × 44 px sans noms visibles. Noms conservés pour les lecteurs d’écran, sélection marquée par une coche et utilisable au clavier.
- Présentation précisée par photos : une activité connue juste au-dessus d’un en-tête neutre de groupe définit les étapes implicites (Shadow puis 3 rounds). Les boutons Round et Répétition génèrent ce titre séparé et des étapes compactes lorsque le type est commun; les titres libres différents, les groupes hybrides et les activités Autre conservent les libellés explicites nécessaires. Aucune durée, intensité ou récupération n’est ajoutée automatiquement. Aide et correspondance des lignes du graphique mises à jour.
- Validation complémentaire : 370 tests réussis, structure et build contrôlés. Palette vérifiée au navigateur à 320 et 375 px : cases uniformes de 44 × 44 px, aucun débordement, une seule rangée à 375 px. Création guidée à 1280 px reproduisant les photos : échauffement de 10 minutes et trois rounds de 3 minutes + 1 minute de repos, total de 22 minutes et sept segments. RPE généré au format existant 4-6/10; aucun changement de sens de la notation /10.
- Publication finale réussie : application `f42411a`, workflow `36074122411`. Les 19 fichiers HTML/CSS/JavaScript publics correspondent exactement à l’artefact GitHub Pages. Onglet de travail de l’utilisateur préservé; aperçus temporaires fermés et dimensions de navigateur rétablies.

## 24 septembre 2026 — Accès aux connexions et saisie des durées

- Bouton Coachs et invitations ajouté dans les en-têtes authentifiés de Mon profil, Mes athlètes et Administration, entre apparence et déconnexion. Même icône, format de 44 px sur mobile et libellé sur ordinateur. Le lien ouvre explicitement les relations personnelles du compte, indépendamment de l’athlète précédemment sélectionné; le bouton contextuel du calendrier garde son comportement.
- Champ Durée : un nombre seul représente désormais des minutes, indiqué brièvement sous le champ. 10M, 10 M et 10 MIN restent acceptés; leur refus signalé n’a pas été reproduit dans le vrai éditeur ni au navigateur. Variante SC ajoutée pour les secondes, dont 2M 30SC. Le texte libre continue d’exiger une unité; un texte tel que « - 10 » ne devient pas une durée. Aide actualisée, contrôles d’erreurs et de reprise après correction conservés.
- Validation : 376 tests réussis, structure, syntaxe et build contrôlés. Tests de navigation personnelle, variantes de durée, décimales, saisies invalides puis corrigées et préservation du texte libre. Vérifications navigateur du formulaire Étape, en-têtes des vrais HTML en aperçu fictif à 320, 375 et 1280 px dans les deux thèmes, et ouverture du panneau Mes coachs depuis son lien. Aucun débordement et aucune donnée réelle modifiée; aperçus et fichiers temporaires retirés.
- Réorganisation des formulaires en discussion : Étape avec titre facultatif, nom libre sur toute la largeur puis mesure/durée côte à côte; Round et Répétition avec noms libres et deux étapes initiales, valeurs 3 MIN et 1 MIN proposées pour les rounds. Ce lot traite les correctifs de durée et d’en-tête.
- Publication réussie : application `0f00ef0`, workflow `36076981749`. Les 19 fichiers HTML/CSS/JavaScript publics correspondent exactement à l’artefact GitHub Pages.

## 24 septembre 2026 — Titres et noms facultatifs dans les outils d’ajout

- Étape : titre facultatif, nom d’étape libre facultatif sur toute la largeur dans son encadré, mesure et durée côte à côte, sans durée proposée. Effort facultatif et consigne visible conservés. Suppression des sélecteurs de type dans les trois outils.
- Round et Répétition : nombre en premier avec boutons −/+, titre libre facultatif, deux étapes initiales aux noms vides. Round propose 3 MIN puis 1 MIN avec l’effort Repos, modifiables; Répétition laisse les mesures vides. Suppression de Type du groupe et Hybride; bouton Ajouter une étape et actions de déplacement/suppression conservés.
- Le texte généré conserve les noms explicitement saisis et peut omettre le nom des étapes. Le graphique interprète le même texte dès l’ajout, sans modèle caché contradictoire. L’édition d’une étape implicite depuis le graphique garde son nom vide, son contexte, son identifiant et ses métadonnées historiques. Noms ambigus et étapes entièrement vides refusés sans écriture partielle. Aide ajustée, aucun exemple dans les champs.
- Validation : 380 tests réussis, dont 41 tests de formulaires et de compatibilité historique; syntaxe, structure et build réussis. Vérification navigateur à 320, 375 et 1280 px, clair et sombre : valeurs des rounds, RPE 4–6 et total de 12 minutes, génération des répétitions, nom implicite conservé après modification graphique, sauvegarde et relecture en aperçu fictif. Marges affinées à 320 px pour conserver Mesure et Durée lisibles côte à côte, sans débordement. Aucun entraînement réel modifié; thème et dimensions rétablis, onglet temporaire fermé.
- Publication réussie : application `a9c2ae1`, workflow `36078833747`. Les 19 fichiers HTML/CSS/JavaScript publics correspondent exactement à l’artefact GitHub Pages.


## 24 septembre 2026 — Séries de mouvements et recherche de relations

- Une étape précédée d’un tiret accepte un nombre de mouvements avant ou après son nom libre (`10x Déplacements` ou `Déplacements 10x`), y compris dans une boucle de rounds ou de répétitions. Le nom reste facultatif. Dans les outils d’ajout : mesure « Répétitions », champ numérique « Nombre », génération du nom suivi du nombre et de `x`. Aucun exercice ni exemple prérempli. Aide mise à jour.
- Une série produit une barre de la couleur et hauteur de son effort, avec un emplacement visuel indicatif indépendant du nombre de mouvements. Aucun temps ni distance n’est inventé; le total conserve uniquement les mesures connues. Les séries reviennent une fois par passage dans une boucle. Édition depuis le graphique, sauvegarde, réouverture et récupération des anciennes lignes de séries vérifiées sans perte des métadonnées compatibles.
- Coachs et invitations : recherche par nom ou courriel complet dans Mes athlètes et Mes coachs, en complément du code existant. Un coach invite un athlète, qui doit accepter; un athlète autorise une demande au coach, qui doit l’accepter. Résultats limités au nom et à l’état du lien, sans coordonnées ni code de connexion. Demandes déjà envoyées indiquées; invitations sortantes annulables; résultats périmés écartés.
- Migration `coach_account_search` appliquée : wrappers publics sans privilèges élevés, implémentations privées, aucun accès anonyme. La recherche et les droits des quatre fonctions ont été vérifiés sur le serveur; aucun nouveau signalement Supabase par rapport au relevé précédent. Les demandes, consentements, accès au calendrier et permissions personnalisées sont testés dans PostgreSQL isolé; aucune invitation réelle envoyée pendant les essais.
- Validation : 388 tests réussis, syntaxe, structure et build vérifiés. Contrôles navigateur à 375 et 1280 px : séries dans les rounds, couleurs et total de 16 minutes sans temps inventé, édition du nombre et réouverture; recherches dans les deux sens et disposition mobile en une colonne sur données fictives. Aperçus temporaires retirés, onglets fermés et dimensions rétablies. Précision finale de l’utilisateur intégrée et testée : nom libre/facultatif, mesure Répétitions, nombre suivi de x.
- Publication réussie : application `4608dfa`, workflow `36080892083`. Les 19 fichiers HTML/CSS/JavaScript publics correspondent exactement à l’artefact GitHub Pages.


## 24 septembre 2026 — Bibliothèque, modification et personnalisation

- Recherche avec loupe dans toute la bibliothèque par défaut, filtre de dossier explicite et petit menu Type à la place des trois boutons. Dossiers personnels, Jog - Base et Boxe - Base réunis; une seule entrée « Mes entraînements (sans dossier) ». Résultats identifiés par dossier et recherche insensible aux accents. Création d’un dossier sans navigation forcée, avec confirmation; renommage conservé.
- Modifier met à jour un entraînement personnel existant. Personnaliser ouvre une copie d’une base dans le même éditeur et ne l’enregistre qu’à la demande. Choix du dossier pendant création/modification, préselection du dossier courant pour les créations. Enregistrer, Annuler, fermer ou Échap ramènent au dossier, à la recherche et au filtre précédents, y compris après ouverture d’une bibliothèque de sélection imbriquée. Terminologie « entraînement » et « bibliothèque » dans les actions, sans « Garder dans mes modèles ».
- Enregistrement limité aux champs autorisés, à l’identité, au propriétaire et à la version chargée. Conflit concurrent signalé sans écrasement et brouillon conservé. La modification ne touche pas aux séances déjà planifiées. Politiques et huit autorisations de colonnes vérifiées en lecture sur Supabase : propriétaire uniquement, aucune permission anonyme. Aucun changement de schéma, aucune écriture sur les données réelles pendant les essais. PostgreSQL isolé vérifie l’édition du document, le rejet d’une ancienne version et l’absence d’accès d’un autre compte.
- Bases enregistrées sous forme de texte et d’étapes concordantes : onze jogs de 10 à 60 minutes avec Z1-Z2; sparring de trois rounds de 2 MIN + 1 MIN Repos; boxe fondamentale avec corde 10 MIN, trois rounds de shadow 3+1, quatre rounds de sac 3+1, trois séries de 30 abdos et 5 MIN de shadowboxing libre. Derniers repos inclus, 43 minutes connues plus trois séries pour la boxe. Alias Shadowboxing reconnu, aucune intensité de boxe inventée.
- Validation : 391 tests réussis; syntaxe, structure et build contrôlés. Parcours navigateur sur données fictives à 320, 375 et 1280 px, clair et sombre : dossier sans changement de vue, recherche globale, personnalisation, classement, modification sans doublon, annulation et bibliothèque imbriquée. À 320 px, champs et boutons passent en une colonne pour rester lisibles; boutons de 44 px sans débordement. Graphique de boxe vérifié, dont les trois portions de 30 mouvements. Aperçu fermé, thème et dimensions rétablis.
- Publication réussie : application `9ee141d`, workflow `36082964534`. Les 19 fichiers HTML/CSS/JavaScript publics correspondent exactement à l’artefact GitHub Pages.

## 24 septembre 2026 — Bibliothèque personnelle et suppression des dossiers

- Filtre Type remplacé par Discipline, combinable avec toute la bibliothèque ou un dossier et la recherche. Boxe, Course, Musculation, Mobilité et Autre; les anciennes séances Sparring sont incluses dans Boxe. Tri naturel des titres.
- Les treize bases deviennent des entraînements privés ordinaires, modifiables, classables et supprimables. Initialisation atomique une seule fois par compte, avec marqueur persistant : supprimer une base ou son dossier ne les recrée pas. Les entraînements personnels existants sont conservés.
- Suppression de dossier avec confirmation du nombre total d’éléments, indépendamment des filtres, et avertissement explicite sur la suppression définitive de tout son contenu. Les séances déjà planifiées sont préservées. Lecture paginée de la bibliothèque; contrôle atomique du propriétaire, du nom, des identifiants et versions avant suppression, refus si le contenu a changé depuis la confirmation.
- Migration personal_library_management appliquée en production. Deux fonctions SECURITY INVOKER, accessibles aux seuls comptes authentifiés avec leurs politiques de propriété. Marqueur protégé par RLS et non supprimable par le client. Vérifications des droits et politiques réussies; aucun nouvel avis de sécurité Supabase par rapport au relevé initial.
- Validation : 395 tests réussis, dont scénarios PostgreSQL isolés d’initialisation, suppression, conflit, isolement des comptes et conservation des séances planifiées. Syntaxe, structure et build réussis. Parcours navigateur fictif à 320, 375 et 1280 px : filtres combinés, avertissement de onze éléments malgré une sélection vide, suppression puis réouverture sans réapparition, modification et déplacement d’une base vers Sans dossier. Aucun entraînement réel supprimé ou modifié pendant les essais; onglet temporaire fermé et dimensions rétablies. Glisser-déplacer vers les dossiers reporté selon la discussion.
- Publication réussie : application `9cf9175`, workflow `36086129057`. Les 19 fichiers HTML/CSS/JavaScript publics correspondent exactement à l’artefact GitHub Pages.


## 30 septembre 2026 — Groupes, notes communes et outils

- Groupes gérés dans Mes athlètes : nom, membres, modification et suppression. Calendrier de groupe limité aux éléments communs; sélecteur Changer séparant personnes et groupes. Le propre nom du coach figure dans les destinataires. Planification pour une personne, plusieurs personnes, groupes ou sélection mixte, avec dédoublonnage. Séances communes modifiables uniquement par leur auteur; réalisation et bilan restent propres à chaque athlète. Notes communes, synchronisation des membres et conservation de l’historique selon les règles documentées.
- Calendrier : bande colorée fine, espace entre tuile et bouton, notes de hauteur adaptée au contenu, cadenas uniquement sur les éléments verrouillés. Une action + par journée ouvre Bibliothèque, Planifier une séance ou Notes; les boutons du haut restent disponibles. Mention « Séance commune » sans nom d’auteur sur les séances concernées.
- Édition : menu de pastilles regroupant quatre pastels et six couleurs de base auprès des commandes du texte. Ouverture mobile des créations de séance, du journal et du sélecteur de calendrier sur un titre neutre pour ne pas ouvrir le clavier avant de toucher un champ.
- Outils dans la navigation : timer de boxe (2/3 minutes, repos 30/60 secondes, avertissement à 30 secondes facultatif, styles Boxe/Classique), timer à intervalles, compteurs bleu/rouge à appuis simultanés et compteur manuel de pas par minute. Pause/reprise, plein écran et signaux sonores; maintien de l’écran selon support navigateur.
- Migrations distantes appliquées avant publication : training_groups `20260930194129`, shared_calendar_notes `20260930194145`, workout_text_base_colors `20260930194217`. Sauvegarde applicative hors dépôt avant migration : 18 tables, 137 lignes, définitions de fonctions, politiques, colonnes, droits et historique. Les lignes préexistantes restent identiques hors nouvelles colonnes nulles. Aucune donnée de test créée en production.
- Vérifications réelles : RLS et politiques présentes sur les huit nouvelles tables, aucun accès anonyme ni écriture directe des clients sur ces tables. Six RPC publics SECURITY INVOKER réservés aux utilisateurs authentifiés. Validation serveur des dix couleurs et rejet des valeurs non autorisées. Requêtes anonymes sur groupes/séances communes/notes communes refusées (401), admin-users POST non authentifié refusé (401). Aucun nouvel avis de sécurité Supabase; avertissements préexistants inchangés.
- Validation isolée : 471 tests réussis, contrôles de sources et build réussis localement puis dans GitHub Actions. Parcours fictifs vérifiés à 320, 390, 768 et 1280 px, propagation des séances et notes communes depuis une copie individuelle, ajout/modification/suppression. Deux appuis tactiles simultanés vérifiés sur les compteurs de coups.
- Publication réussie : application `6ce6b86`, [workflow `36767802592`](https://github.com/mixmasterkd/gestionboxeur/actions/runs/36767802592). Les 26 fichiers publics sont identiques par SHA256 à l’artefact GitHub Pages; tools.html répond HTTP 200.
- Contrôle mobile du site public déconnecté à 320 et 390 px : Calendrier et Outils rejoignent Connexion, aucun débordement ni ressource manquante, aucun champ focalisé automatiquement. Les parcours connectés ont été validés en aperçu fictif et dans PostgreSQL isolé, sans manipulation de comptes réels. Une transition CSS Chromium préexistante est annulée sur un parcours de redirection (« Transition was skipped »), sans impact visible.
## 8 octobre 2026 — Groupes ouverts, validation locale uniquement

- Ajout de Mes groupes depuis le menu Mon profil, avec babillard, suggestions/commentaires/soutien, sondages et gestion des membres. Créateur/admin/membre sont des rôles propres au groupe. Même compte membre dans un groupe et admin/créateur ailleurs; aucun gym obligatoire ni hiérarchie de groupes. Calendrier Jour/Semaine/Mois et style existants conservés.
- Invitations de groupe et de coaching dans une boîte de notifications; badge maintenu jusqu’à réponse. Les liens individuels coach–athlète conservent leurs permissions distinctes. Admin de groupe ne donne aucun accès au calendrier privé, notes privées ou bilans des membres.
- Sélecteur de calendrier réservé aux groupes gérés; copies distribuées dans les calendriers personnels avec réalisation et bilan individuels. Lecture d’une séance multigroupe possible depuis chaque groupe géré, modification réservée aux personnes autorisées sur toutes les destinations. Historique, copies réalisées et bilans conservés lors des départs/suppressions; aucun doublon pour un même master.
- Migration locale `20261009053411_open_community_groups.sql`, RPC publiques invoker vers fonctions privées avec contrôles de droits, grants explicites et RLS. Revue indépendante : ancien admin auteur d’un master ne pouvait pas garder sa lecture après retrait; lecture multigroupe séparée de l’autorisation de modification. Les deux cas sont corrigés et testés. Compatibilité des anciens groupes/fiches non liées et des permissions de coaching conservée.
- Validation : 771 tests automatisés réussis, dont 62 tests SQL. Les derniers ajustements de texte ont été revérifiés par la suite ciblée calendrier/dialogues/données. 77 parcours navigateur calendrier/timer réussis sur six tailles (7 exclusions prévues); deux parcours interrompus par rechargement Vite ont réussi au rerun ciblé. Quatre parcours supplémentaires sur la vraie base locale réussissent sur téléphone et ordinateur : création/modification par un autre admin, réception unique, Fait/bilan individuel, retrait avec historique, invitation, suggestion et vote/clôture.
- QA groupes : cycle création/invitation/acceptation/commentaire/soutien/sondage/vote/promotion/transfert/suppression et 24 contrôles de disposition sur 320,390,844,1440 px, thèmes clair/sombre. Menu profil accessible en paysage grâce au défilement du rail existant. Aucun débordement ni erreur JavaScript sur ces vérifications.
- Environnement LAN `http://192.168.50.123:4173` avec comptes fictifs, PGlite persistant, transport Vite DEV et aucune connexion à la base distante. Isolation SQL et requêtes paramétrées testées. Les dates SQL gardent le format YYYY-MM-DD utilisé par le calendrier. Les fixtures/transports locaux sont absents du build de production. Bases QA archivées sous `.local-preview/qa-*`; base neuve d’exemples laissée disponible pour les essais utilisateur.
- Contrôles de syntaxe/HTML, build et CSS compilées réussis. Aucun commit, push, migration distante ou déploiement pour cette évolution; publication en attente du go utilisateur.

## 8 octobre 2026 — Menu direct et retours, deuxième passe locale

- « ☰ Menu » remplace l’entrée Mon profil dans la navigation. Panneau non modal ancré à côté du rail sur ordinateur, au-dessus de la barre mobile, avec bouton actif, fermeture extérieure, clavier et focus. Mes groupes et chaque groupe apparaissent directement; le groupe courant est surligné et s’ouvre dans la page principale. Notifications, Mes liens, Installer GBoxeur puis Mon profil suivent. L’installation conserve son invite native entre les remontages de navigation et propose un retour au menu; le bloc au bas du profil est retiré.
- Retour Menu depuis les notifications et l’aide à l’installation; chaque ouverture repart du menu principal. Retour Mes groupes visible dans le groupe et historique navigateur fonctionnel, sans rechargement pour les changements de groupe sur la même page.
- Suggestions remplace Babillard dans les groupes : création de suggestions, soutien et commentaires conservés; messages existants masqués sans suppression. Sondages et membres conservés.
- Lectures liste/détail parallèles, cache mémoire des groupes isolé par compte, durée courte, lectures simultanées regroupées, invalidation des changements de rôles/membres et réponses tardives rejetées. Retour immédiat à la liste connue, réessai explicite en cas d’erreur. Notifications également regroupées et actualisées après une réponse.
- Validation : 787 tests réussis, contrôle des sources et build réussis. Deux nouveaux parcours téléphone/ordinateur en lecture seule couvrent navigation directe, installation et retours; 12 parcours de non-régression calendrier/navigation réussissent sur six formats et les deux thèmes. QA visuelle : 24 contrôles des onglets de groupe et 8 contrôles du menu sur 320, 390, 844 et 1440 px, clair/sombre; aucun débordement ni erreur JavaScript. Historique et réponse réseau retardée vérifiés; une seule lecture de liste sur le parcours de changement de groupes.
- Les parcours QA de cette passe bloquent les mutations réseau et conservent les données des essais utilisateur. Aucune réinitialisation de la base locale, écriture distante, migration distante, commit, push ni publication. Le serveur LAN reste accessible à http://192.168.50.123:4173. L’interdiction d’écrire dans la base en service et la nécessité d’une autorisation séparée pour toute évolution distante du schéma sont documentées dans README.

## 8 octobre 2026 — Listes personnelles, journal et accès direct aux outils, préproduction

- Athlètes devient une destination stable pour tous les comptes. La page Liste d’athlètes affiche uniquement la liste personnelle du compte, avec ajout direct d’une fiche et sans onglets Athlètes/Groupes. Les Coachs de contact sont manuels et propres à cette liste; le propriétaire et les coachs liés ne sont plus ajoutés automatiquement aux listes préparées. Le rattachement et les permissions des relations existantes sont conservés, sans activation implicite des fonctions coach.
- Coachs et invitations est l’entrée unique de gestion des relations, avant Mes groupes dans Menu. Les doublons du haut du calendrier et de Mon profil sont masqués ou retirés. Les renseignements sportifs sont ouverts dans le profil; l’inscription et le bouton Activer les fonctions coach gardent leur fonctionnement.
- Un sujet créé ouvre immédiatement son détail, avec guide et ajout direct d’une observation ou d’un conseil. Statut et actions alignés sur téléphone et ordinateur. Archives en liste verticale unique avec recherche et restauration du statut précédent. Suppression définitive confirmée du sujet et de ses suivis, soumise aux droits et à une vérification de version/historique; un conflit propose d’actualiser le sujet avant une nouvelle tentative.
- Migration locale `20261009053420_personal_rosters_and_journal_deletion.sql` : listes accessibles aux profils sans fonctions coach, sans changer leur rôle; suppression via wrappers publics invoker et fonctions privées contrôlées. Aucun droit DELETE général ajouté. Sept tests PostgreSQL couvrent les permissions, l’isolation des comptes, les versions périmées, les suivis ajoutés après ouverture et la suppression en cascade. Revue indépendante des droits des anciennes fonctions de coaching effectuée.
- Outils ouvre un panneau compact avec dix destinations directes : cinq outils et cinq jeux cognitifs. Icône et titre seulement, défilement interne, bornes du viewport, clavier/Escape, fermeture extérieure et exclusion mutuelle avec Menu. Ouverture directe depuis une autre page et changement sans rechargement dans les outils; sélection courante et historique suivent l’écran effectivement accepté. Les confirmations des modifications non enregistrées, les protections des jeux et le verrouillage des timers restent respectés. Une nouvelle sélection du même outil conserve sa mesure en cours. Compatibilité HTTP LAN sans dépendance à crypto.randomUUID.
- Les anciens modules d’interface Groupes de la liste et le sélecteur d’ajout intermédiaire ont été retirés avec leurs tests devenus obsolètes. Les styles de destinataires du calendrier et les permissions existantes restent présents.
- QA navigateur : 12 parcours intégrés réussis sur téléphone/ordinateur, dont journal complet, isolation des listes, profil/relations et outils avec retours/rechargement. Menu Outils vérifié à 320, 390, 844 et 1440 px dans les deux thèmes, sans débordement. Les 24 parcours ciblés de non-régression calendrier passent, dont un relancé après collision de fichiers de traces. Les deux parcours du menu de groupes en lecture seule passent après stabilisation des sources (un rechargement Vite avait fermé le panneau pendant le premier essai). Les sorties Playwright des trois configurations sont désormais séparées.
- Base utilisateur `.local-preview/database` préservée, sauvegarde préalable `.local-preview/before-personal-roster-20261009`. Les nouveaux tests CRUD utilisent exclusivement une base fictive distincte sur 127.0.0.1:4174. Vérification directe du menu Outils et des retours sur le LAN HTTP 192.168.50.123:4173 en lecture seule, avec blocage des mutations et des appels distants : réussie.
- Validation finale : 809 tests automatisés réussis, contrôles de syntaxe/HTML et compilation réussis. Le build vérifie aussi les CSS mobiles et l’absence du transport local dans la version de production.
- Aucune écriture dans la base en service, migration distante, publication, commit ou push. Le serveur des essais utilisateur reste disponible sur http://192.168.50.123:4173.

## 8 octobre 2026 — Choix des outils dans un seul menu, préproduction

- Retrait effectif des grilles Outils et Jeux cognitifs, de leurs styles inutilisés et des boutons de retour vers ces écrans. Le menu Outils donne accès directement aux dix destinations; les commandes propres aux outils et les sorties du plein écran restent présentes. Le titre principal nomme le jeu choisi, sans doublon visuel avec son titre interne.
- Une adresse Outils sans sélection ou invalide ouvre directement le timer de boxe, en remplaçant l’entrée courante de l’historique. Les anciens liens vers Jeux cognitifs sans jeu précis ouvrent Tuiles. Les changements d’outil, la réselection sans réinitialisation, le retour navigateur, les confirmations des brouillons/parties et les timers verrouillés restent protégés. Un chargement de jeu échoué propose Réessayer sur place.
- Ordre du menu principal demandé par l’utilisateur : Notifications, Coachs et invitations, Mes groupes avec les groupes dessous, Mon profil, Installer GBoxeur en dernier. Les badges, liens directs et retours des notifications/installations sont conservés.
- Tout reste local; aucune modification de schéma, donnée de la base en service, publication, commit ou push. La base des essais utilisateur sur 192.168.50.123:4173 est conservée.
- Validation finale : 817 tests automatisés réussis, 10 parcours navigateur téléphone/ordinateur réussis, contrôles de syntaxe/HTML et compilation réussis. Les parcours ouvrent les dix destinations, vérifient les anciens liens, les retours navigateur, l’ordre du menu, les sorties du plein écran et le défilement du panneau à 320/844/1440 px. Vérification visuelle sur le LAN HTTP à 390 px : titre unique du jeu, aucun retour intermédiaire, ordre du menu conforme; mutations et appels distants bloqués pendant ce contrôle.

## 8 octobre 2026 — Invitations par nom et liens de groupe, préproduction

- En-tête de groupe simplifié : retrait du rappel Calendrier, de son bouton et de la description affichée dans le détail. La description enregistrée est conservée. Suggestions ouvertes aux membres; création des sondages réservée au créateur et aux admins, droits de vote conservés.
- Ajouter des membres propose les athlètes liés au compte demandeur, avec recherche prénom/nom/courriel insensible aux accents, sélection multiple, pagination et défilement borné. États Déjà membre, Invitation envoyée et Compte non lié. Les invitations nécessitent une réponse; aucun compte, rattachement de fiche ou lien coach n’est créé automatiquement.
- Courriel et lien partageable disponibles dans des sections secondaires. Liens hachés côté serveur, durée par défaut de sept jours, renouvellement invalidant l’ancien lien et révocation. Adhésion explicite après connexion/inscription, rôle Membre uniquement et aucun accès aux données personnelles du membre. Copie compatible avec HTTP LAN et solution manuelle. Message de lien expiré/révoqué corrigé sans masquer les erreurs réseau.
- Nouvelle migration locale `20261009053421_group_batch_invitations_and_join_links.sql` : table sous RLS sans accès direct anon/authenticated, wrappers invoker, fonctions privées contrôlées et search_path fixé. Invitations multiples atomiques et limitées aux relations acceptées du demandeur; verrouillage commun avec les changements de rôle. Revue indépendante favorable; aucune faille concrète relevée dans les chemins de permissions ou de redirection. Pas de test de concurrence sur PostgreSQL hébergé.
- Les jetons d’invitation ne sont pas diffusés dans les événements de mise à jour. Recherche sans invalidations superflues du menu; réponses périmées rejetées lors des changements de compte, de recherche ou de groupe. SessionStorage bloqué ne bloque plus le formulaire de connexion. Confirmation d’inscription vérifiée avec Auth simulé uniquement; aucun vrai courriel envoyé.
- Validation finale : **856/856 tests automatisés**, contrôles de syntaxe/HTML et build réussis. **6/6 parcours navigateur** réussis sur téléphone/ordinateur : sélection par nom et accents, invitations multiples, acceptation, limites de rôle, lien partagé, renouvellement, révocation, pagination et longues listes. Huit contrôles de disposition à 320/390/844/1440 px, thèmes clair/sombre, sans débordement. Le serveur QA utilise exclusivement `/tmp/gboxeur-personal-journal-qa-db`; les données propres au test interrompu ont été nettoyées.
- Sauvegarde LAN `.local-preview/before-group-invitations-20261008T233014` avant application locale. Comparaison de toutes les données préexistantes : **37 tables et 61 lignes inchangées**. Serveur relancé sur `http://192.168.50.123:4173`, HTTP 200. Vérification navigateur LAN en lecture seule, sans mutation ni erreur JavaScript; absence de liens coach acceptés expliquée dans la liste vide des comptes fictifs.
- Aucun commit, push, déploiement, migration distante ni écriture dans la base en service. Les données des essais utilisateur sont conservées.

## 9 octobre 2026 — Menus sobres et tiroir mobile, préproduction

- Go limité à Menu/Outils : styles des boutons desktop harmonisés avec les autres entrées, panneaux arrondis, titres neutres dans la police de l’application et retrait des X. La barre mobile conserve ses styles existants. Aucune modification des sondages ou de l’activation coach pour cette passe.
- Géométrie et décalage partagés dans `menu-panel-layout.js`. Tiroir mobile pleine hauteur, bande droite de fermeture accessible au clavier et défilement interne. Contenu décalé sans restructuration du DOM; dialogues, toasts et lien d’évitement exclus. Fond verrouillé, position de lecture conservée, animation réduite lorsque l’appareil le demande. Nettoyage au changement de menu, fermeture, changement de taille ou démontage, avec protection contre les événements close tardifs.
- 865 tests automatisés réussis, dont neuf nouveaux tests de géométrie et de nettoyage. Contrôles de sources, build et CSS compilées réussis. Les scénarios E2E existants sont adaptés à la fermeture par la bande sur mobile; validation navigateur de cette passe effectuée avec CUA sur le serveur LAN.
- QA navigateur sur Groupes et Outils : 320×568, 390×844, 844×390 et 1440×900; thèmes clair/sombre; égalité des couleurs et dimensions des boutons desktop, titres sans rouge, absence des X, changement de menu, fermeture au même bouton, Escape, bande droite et clavier. Défilement interne sur petit écran, fond immobile à scrollY=141 et position inchangée après fermeture. Notifications/retour au menu, navigation directe vers MRJEU et vers le timer de boxe vérifiés sans créer ni modifier de données.
- Serveur LAN conservé à `http://192.168.50.123:4173`. Aucun changement SQL, écriture de données QA, compte créé, commit, push ou publication. Les essais utilisateur restent en place.

## 9 octobre 2026 — Ordre mobile et accès Administration, préproduction

- Go utilisateur : Menu, Outils, Calendrier, Journal et Athlètes dans la barre mobile. Réorganisation réelle des nœuds au seuil de 800 px, conservation du focus et nettoyage du listener au remontage; ordre ordinateur conservé.
- Administration retiré de la barre principale et placé dans Menu après Mon profil, avant Installer GBoxeur. Visibilité conditionnée au droit `isAdmin` déjà vérifié par la page, lien actif dans l’administration, chemins relatifs préservés et retrait du droit mémorisé au changement de compte. Aucun élargissement de droits.
- 44 tests ciblés réussis sur navigation, menu du compte, menu outils et disposition des panneaux. Couverture de l’ordre mobile/ordinateur au redimensionnement, du remontage, du focus, de la visibilité admin et du changement de compte. Contrôles des sources et build réussis.
- QA CUA en lecture seule sur le LAN à 320/390/1440 px : cinq entrées sans débordement, Calendrier au centre, tiroirs Menu/Outils à gauche, fermeture et retour aux panneaux arrondis sur ordinateur. Absence d’Administration pour le compte fictif ordinaire; branche admin vérifiée par test unitaire avec rôle simulé, sans créer de compte admin dans la base locale.
- Serveur LAN conservé; aucune écriture dans la base locale ou de production, aucune migration ni publication pour cette passe.
- Go suivant : sur mobile uniquement, icône Calendrier de 24 px dans une pastille arrondie aux couleurs du thème, avec accent renforcé pour la section active. Hauteur de barre conservée à 78 px et libellés inchangés. QA navigateur à 320/390 px dans les thèmes clair/sombre, aller-retour Calendrier/Journal, contrôle du style ordinateur à 1440 px; contrôles des sources, build et cascade CSS compilée réussis. Modification limitée au CSS, aucune donnée modifiée.
- Ajustement visuel approuvé après essai : pastille retirée, icône d’origine conservée à 24 px sur mobile, libellé légèrement plus gras et fond actif habituel du bouton. Taille du texte, hauteur de barre et style ordinateur conservés. QA clair/sombre à 320/390 px, alternance Calendrier/Journal et retour ordinateur à 1440 px réussis; contrôles des sources et build réussis. CSS uniquement, préproduction locale.
- Go après aperçu comparatif : bouton Calendrier mobile entièrement rempli, anthracite en clair et gris bleuté clair en sombre, avec texte/icône contrastés. Un trait de 16×2 px sous le libellé apparaît uniquement pour `aria-current="page"`; le fond persiste dans les autres sections. Hauteur conservée à 78 px, style ordinateur inchangé. QA navigateur à 320/390 px dans les deux thèmes, passage Calendrier/Journal et retour à 1440 px réussis; contrôles des sources, build et CSS compilées réussis. Aucun changement de données ni publication.


## Publication autorisée du 9 octobre 2026 — vérifiée

- Autorisation explicite reçue pour sauvegarder la base applicative, appliquer les trois migrations présentées, puis publier. Aucun transfert des données fictives.
- Sauvegarde privée hors dépôt : 30 tables, 210 lignes, métadonnées et historique des 27 migrations précédentes; fichier protégé en lecture/écriture propriétaire uniquement. Auth et objets Storage exclus. Restauration PGlite puis application des trois nouvelles migrations validées; toutes les données historiques comparées à l’identique.
- Production : migrations `20261009053411_open_community_groups.sql`, `20261009053420_personal_rosters_and_journal_deletion.sql`, `20261009053421_group_batch_invitations_and_join_links.sql` appliquées. Après migration, 30 tables et 210 lignes comparées sans différence sur les anciennes colonnes. Huit tables ajoutées, toutes vides, RLS activée et aucun droit direct pour anon/authenticated/PUBLIC. Les trois nouvelles/remplacées façades RPC sont SECURITY INVOKER.
- Les huit avis RLS sans politique supplémentaires sont attendus : ces tables sont accessibles par RPC contrôlée, avec droits directs révoqués. Le nombre de fonctions publiques SECURITY DEFINER signalées passe de 18 à 17. La protection des mots de passe compromis reste désactivée, comme avant cette publication : [configuration Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Les avis de performance signalent aussi les clés étrangères sans index couvrant (dont le lien composite des votes), les appels Auth dans les politiques et les politiques de lecture cumulées. Cette publication ne prétend pas les résoudre; les permissions des groupes sont couvertes par les tests d’isolation.
- Prévol : 867 tests isolés, contrôles des sources et compilation réussis. La compilation de production ne contient ni le transport local ni les comptes fictifs. Les noms de migrations locales sont alignés sur Supabase et leur correspondance de préproduction conserve les bases d’essai existantes; un test de réouverture couvre cette transition.
- [Publication GitHub Pages réussie](https://github.com/mixmasterkd/gestionboxeur/actions/runs/37889377517) depuis `6f159f7705e1cccad17b335ce200c1ed9d840624`. GitHub valide 868 tests isolés et 77 parcours navigateur; 7 combinaisons volontairement ignorées. Contrôles des sources et build réussis. Les 43 fichiers publics sont identiques octet pour octet à l’artefact publié. Les marqueurs du transport et des personas locaux sont absents des 31 fichiers HTML/JS construits.
- Vérification connectée en lecture sur le site publié : calendrier, menu et ouverture du groupe existant réussis, aucune erreur console observée. Aucune suggestion, invitation, séance ou compte créé pendant cette vérification. La lecture des groupes et des notifications sous le rôle authentifié est également vérifiée en transaction SQL read only. Le LAN répond toujours en HTTP 200 et sa lecture des groupes d’essai fonctionne. Les mutations multi-comptes restent validées dans les bases isolées, sans essai d’écriture sur les utilisateurs réels.

## En-tête compact du calendrier — essais locaux du 9 octobre 2026

Go utilisateur limité à la présentation sur ordinateur et cellulaire : nom/adresse du gym masqués sur la page de planification; nom du calendrier intégré au sélecteur en haut, bibliothèque par icône avec libellé accessible et infobulle. Les grands boutons de création et le titre répété disparaissent de la vue Calendrier; les actions de création restent dans le choix d’une journée. Le journal conserve son titre et son contenu. Les statistiques et les vues Jour/Semaine/Mois ne sont pas déplacées.

Le sélecteur utilise la géométrie commune des menus : panneau arrondi sous le bouton sur ordinateur, tiroir à gauche avec marge de fermeture sur mobile. Fermeture par bouton, extérieur ou Échap, recherche et retour du focus vérifiés. Sur mobile, le titre reçoit le focus sans ouvrir d’emblée le clavier. Le nom complet demeure accessible lorsque l’espace exige une ellipse. Aujourd’hui partage la ligne des dates sur mobile. La zone Notes du formulaire de note passe de 3 à 6 lignes, avec un minimum de 150 px et redimensionnement conservé.

Validation : 870 tests isolés réussis, puis 105 tests ciblés réussis après les ajustements finaux; contrôles des sources et compilation réussis. Vérification navigateur LAN à 320/390/1440 px, thèmes clair/sombre, choix d’un groupe puis du calendrier personnel, recherche, bibliothèque, journal et ouverture/annulation d’une note. Aucun contenu créé pendant ces vérifications. La suite E2E a été adaptée aux entrées par journée mais n’a pas été relancée dans cette passe. Aucun push, déploiement, changement de schéma ou accès à la base de production. URL d’essai : http://192.168.50.123:4173/planning.html.

### Correction du chevauchement et position de Bibliothèque

Chevauchement reproduit à 900 px : l’ancienne `.main-nav`, vide mais toujours en `width:100%` entre 801 et 950 px, réduisait le bloc calendrier à 0 px. Elle est maintenant masquée sur toute la page de planification lorsque la navigation principale est montée. À la demande suivante, Bibliothèque est placée dans le groupe de droite, immédiatement avant clair/sombre, puis Déconnexion; l’ordre DOM et clavier suit cet ordre.

Vérification navigateur : aucun chevauchement à 320/390/620/800/801/844/900/950/951/1280 px après le correctif; position finale de Bibliothèque vérifiée de 320 à 1280 px, espacement de 8 px avec clair/sombre, thème sombre vérifié puis thème initial restauré. Les contrôles du CSS compilé couvrent désormais aussi les seuils intermédiaires du calendrier dans les deux thèmes. 17 tests ciblés apparence/navigation, contrôles des sources et build réussis. Correction locale uniquement, sans publication.

### Statistiques discrètes et retrait du raccourci Aujourd’hui

Go utilisateur : suppression du bouton de retour Aujourd’hui sur ordinateur et mobile, sans retirer le repère du jour dans les cases ni la vue Jour. Le grand encadré statistique est remplacé par deux lignes sobres : nombre de séances et durée prévue pour la période affichée, puis course cette semaine. Les calculs restent inchangés; les mentions de durée partielle, manquante ou indisponible et la distance connue sont conservées. La plage hebdomadaire reste disponible dans l’infobulle du total de course.

Validation : 42 tests ciblés réussis, contrôles des sources et build réussis. Vérification navigateur locale en clair/sombre et aux largeurs 320/390/801/950/1280 px : aucun débordement horizontal, résumé standard de 43 px de haut et deux flèches de navigation conservées. Le scénario E2E concerné est adapté au retrait du bouton; la suite E2E n’a pas été relancée pour cette passe. Thème et vue initiaux restaurés après QA. Aucun changement de données, publication ou accès à la base de production.

### Logo et barre commune dans Calendrier, Journal et Athlètes

À la demande de l’utilisateur, logo remis à gauche sans nom/adresse du gym. La bibliothèque reste visible dans le Journal. La page Athlètes reprend le même en-tête compact : logo, sélecteur de calendrier, bibliothèque, thème et déconnexion. Son sélecteur réutilise le panneau arrondi/tiroir mobile; il ouvre le calendrier choisi sans filtrer la liste personnelle. L’icône Bibliothèque depuis Athlètes ouvre directement la bibliothèque sur la page de planification. Les liens entre ces sections conservent le calendrier sélectionné, avec nettoyage du contexte de groupe lors du passage au journal personnel.

63 tests ciblés réussis, puis 42 tests du calendrier après le dernier ajustement du contexte Journal. Contrôles des sources, build et CSS compilé réussis. QA LAN : logo visible et aucun chevauchement/débordement des en-têtes à 320/390/801/950/1280 px; bibliothèque ouverte depuis Journal et Athlètes, sélection du calendrier MRJEU, panneau ordinateur et tiroir mobile, clair/sombre et restauration du thème initial. Tests ciblés ajoutés pour les calendriers liés/groupes administrés et les lectures tardives après changement de compte. Aucune donnée créée ou modifiée, aucune publication.

## Publication de l’en-tête et du calendrier compact — 9 octobre 2026

Go explicite pour publier les changements locaux validés : en-tête commun avec logo, sélecteur et bibliothèque; statistiques compactes; retrait du raccourci Aujourd’hui; zone de saisie des notes agrandie. Aucun changement du serveur, des migrations ou des données de production. Les données fictives et fichiers de préproduction restent exclus du site construit.

Prévol de publication : contrôles des sources et build réussis. Mise à jour du harnais des tests isolés du roster pour son nouveau module d’en-tête (testé séparément), et attente de la fin de l’animation du tiroir dans le contrôle navigateur de ses limites. Le workflow GitHub Pages doit valider tous les tests avant le déploiement.
