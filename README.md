# gestionboxeur

Gestion des boxeurs, listes combat/sparring et calendrier partagé entre athlète et coachs. Interface sportive ivoire, graphite et bleu ciel, avec un dessin vectoriel original, le nom du gym dans l'en-tête et aucune initiale du projet utilisée comme logo. La navigation est latérale sur ordinateur et placée en bas sur téléphone. Les couleurs des zones d'effort conservent leur signification.

Le nom technique du dépôt reste **gestionboxeur**. Le nom du gym demeure une donnée personnalisable. Le projet de référence est ce dossier `gestionboxeur/`; les anciennes pages et copies de scripts dans le dossier parent ne font pas partie de la construction Vite.

## Démarrage local

Prérequis : **Node.js 22.12 ou plus récent** et npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Ouvrir l'adresse indiquée par Vite. `.env.local` configure `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`. La clé publique fournie est destinée au navigateur; une clé `service_role` ne doit jamais apparaître dans une variable `VITE_*`.

L'accueil (`index.html`) ouvre les athlètes et les listes du coach. `planning.html` ouvre le calendrier; les comptes athlètes y sont dirigés après connexion. Les anciens liens `roster.html` sont conservés par redirection.

### Aperçu sans compte ni données réelles

Avec `npm run dev`, ouvrir `http://127.0.0.1:5173/planning.html?demo=coach` ou `http://127.0.0.1:5173/planning.html?demo=athlete`. Ces aperçus permettent de créer, modifier, verrouiller et déplacer des séances fictives, essayer les blocs et les graphiques, et ajouter des événements. Tout reste en mémoire et se réinitialise au rechargement. Les liens vers les profils, les listes ou l'administration rejoignent le véritable parcours connecté. L'aperçu est exclu de la construction de production; il ne remplace pas le compte athlète de test connecté.

Les fiches, sélections, contacts et listes fonctionnent avec le schéma Supabase historique et le nouveau schéma. Le mode historique n'est activé qu'en cas d'absence confirmée du nouveau schéma, jamais pour contourner une erreur de permission ou de connexion.

La planification connectée exige les migrations jusqu'à `20260922130000_session_completion.sql`, et le rattachement de doublons exige `20260922140000_roster_attachment.sql`. **Le correctif compatible `20260921110000_secure_profile_roles.sql` a été appliqué et vérifié sur le projet distant le 22 septembre 2026 (heure de Toronto). Les quatre migrations fonctionnelles suivantes attendent la publication coordonnée de la nouvelle interface.** Le schéma distant ne contient pas encore `profiles.account_type`, `training_sessions` ni `gyms`. Avec ce schéma historique, le calendrier indique qu'il n'est pas encore activé et les inscriptions athlètes sont bloquées pour éviter de créer par erreur un compte coach. Les listes historiques restent accessibles.

```bash
npm run check
npm test
npm run build
npm run preview
```

- `check` vérifie la syntaxe JavaScript, les identifiants HTML, les dialogues accessibles et les balises mobiles.
- `test` vérifie les dates, les calculs de blocs, les parcours d'interface et les protections entre comptes.
- `build` produit le site statique dans `dist/`; `preview` permet de consulter cette construction localement.

## Parcours

Un **coach** peut créer une fiche libre avec un prénom et en modifier toutes les informations. Cette fiche sert aux listes; aucun compte ni calendrier n'est obligatoire. **Un seul tableau**, accessible par « Mes athlètes », réunit toutes ses fiches et tous ses comptes athlètes liés et acceptés, y compris ceux sans droit de consultation du calendrier. Aucun regroupement ni filtre par type de compte et aucune entrée « Mes listes » redondante dans le menu. Le bouton « Préparer une liste » du tableau ouvre le générateur ; il n'y a pas de bibliothèque ni d'historique de listes. Les anciens liens `?liste=1` restent compatibles et ouvrent le même tableau, sans lancer le générateur. Les notes privées et les sélections appartiennent à la relation de chaque coach avec l'athlète. Les textes de navigation et les en-têtes sont fonctionnels, sans slogans.

Le bouton **Rattacher…** sur une fiche libre propose une invitation pour une nouvelle inscription ou le rapprochement avec un compte inscrit déjà lié au coach. Aucun rapprochement automatique par nom : le coach choisit le compte et confirme qu'il s'agit de la même personne. En cas d'écart, il choisit le poids et le bilan complet (combats/victoires/défaites) à conserver, sans addition des combats. Le compte, son identité, son calendrier et ses permissions restent intacts. Les notes des deux relations sont conservées et la sélection est maintenue si l'athlète est disponible. Seule la relation à l'ancienne fiche est archivée pour ce coach; la fiche globale et les relations des autres coachs ne sont pas supprimées. Des versions périmées bloquent le rattachement et demandent une nouvelle vérification. Une fiche libre possédant déjà des données de calendrier ne peut pas être rattachée par ce parcours.

L'inscription propose **athlète par défaut**, ou coach. Pour un athlète, la date de naissance est obligatoire et l'âge est calculé. Genre M/F, poids KG/LBS, nombre de combats, victoires et défaites sont proposés; seule la date de naissance est un nouveau champ obligatoire. Les anciens profils incomplets conservent leurs données et doivent compléter la date de naissance lors de l'enregistrement de leur profil. L'athlète modifie son identité, ses coordonnées, son gym et sa disponibilité depuis `profile.html`. Ses coachs liés peuvent modifier son poids et son bilan sportif, sans changer son identité.

Le répertoire commun des gyms est sélectionnable à l'inscription. Un gym ajouté avec son adresse par un coach devient disponible immédiatement; les couples nom/adresse identiques, après normalisation des espaces et de la casse, sont réutilisés. L'administration peut ajouter ou corriger un gym. Le Crew est proposé par défaut, avec son adresse existante si elle est connue; aucune adresse n'est inventée. Choisir un gym ne donne aucun accès automatique à ses coachs.

Le coach peut créer un **lien d'invitation** valable sept jours. L'athlète s'inscrit ou se connecte avec un compte athlète, puis accepte le lien pour retrouver la fiche d'origine. Le profil automatique d'une inscription peut être remplacé uniquement s'il est encore vierge. Une fiche déjà utilisée est conservée; l'application invite alors à employer le code coach.

Un **athlète déjà connecté** peut saisir le code d'un coach. La demande reste en attente jusqu'à l'acceptation du coach. Plusieurs coachs peuvent être associés au même athlète. Celui-ci contrôle, pour chacun, l'accès au calendrier, l'ajout de séances et d'événements, la modification des éléments partagés et la lecture des retours. Retirer un coach conserve l'historique.

L'athlète et ses coachs autorisés peuvent créer des séances structurées, des événements et des notes dans le même calendrier. Un élément **déverrouillé** peut être modifié et déplacé par l'athlète et les coachs autorisés. Un élément **verrouillé** est modifiable uniquement par son créateur. Seul le créateur peut changer le verrouillage ou supprimer l'élément; ses droits d'accès doivent toujours être actifs. L'auteur d'origine reste affiché après une modification par un collaborateur. Une suppression de séance demande confirmation et supprime également son feedback.

Seul l'athlète concerné peut marquer une **séance faite** ou annuler ce statut, depuis la tuile du calendrier ou le détail de la séance, même si celle-ci est verrouillée par son coach. Aucun bilan n'est exigé pour cocher la séance. Après l'avoir cochée, il peut ouvrir le bilan facultatif pour renseigner le RPE, le ressenti et un commentaire portant sur la séance entière. Le coach voit le statut fait/à faire; l'accès au bilan reste soumis à l'autorisation de lecture des retours. Annuler le statut conserve le bilan enregistré, sans l'afficher tant que la séance n'est pas recochée.

La bibliothèque du coach distingue **Mes modèles**, privés à son compte, et le **Kit de départ** disponible sans enregistrement préalable. Le kit propose 11 jogs de 10 à 60 minutes par tranches de 5 minutes et une séance Boxe fondamentale : corde 5 min, 4 rounds de shadow de 2 min avec 1 min de repos entre les rounds, 4 rounds de sac au même format, puis abdos 5 min (32 min au total). Ce sont des bases entièrement ajustables, sans prescription individualisée. Le bouton « Garder dans mes modèles » copie uniquement le modèle choisi; aucune insertion automatique du kit n'est faite dans la base.

Une séance ou un bloc enregistré s'utilise comme copie modifiable; supprimer un modèle ne supprime pas les séances déjà planifiées. « Garder comme modèle » est aussi disponible directement dans le formulaire de création, sans devoir planifier la séance. Un remplacement par un modèle demande confirmation si le formulaire contient déjà des informations.

Le programme propose deux vues synchronisées : **Programme**, une ligne lisible par étape, et **Texte**. Toucher une ligne ouvre un petit formulaire; les boutons Étape, Répétition et Rounds permettent de créer des blocs sans connaître la notation. Les réglages avancés sont repliés. Le glisser-déposer et les boutons monter/descendre restent disponibles, y compris dans les répétitions. Un formulaire de bloc doit être validé ou annulé avant d'enregistrer la séance. Dans une séance de course, les nouvelles étapes sont de la course par défaut; changer de discipline ne réécrit pas les blocs existants.

L'aide « Écrire un entraînement » explique la nomenclature et fournit un exemple. Cette syntaxe est propre à la plateforme, inspirée du principe des éditeurs texte d'entraînement; elle ne garantit pas une compatibilité complète avec Intervals.icu ou Nolio.

```text
Course
2x
  1m @ Z2
  1m @ Z1 - Marcher si nécessaire

Shadow
3 rounds 1m/1m - Faire du 8/16
3 rounds 30s/30s - In and out / burpees
```

- `m` signifie minutes, `s` secondes; `1m30s` et `1m30` sont acceptés. Une distance doit être explicite : `400 mètres`, `400mtr` ou `1km`.
- Un en-tête donne le type et le nom aux étapes suivantes. `Course : Footing léger` donne un titre personnalisé. `Libre - Consigne` décrit un bloc sans durée.
- `2x` répète les étapes indentées de deux espaces. Revenir au bord gauche termine la séquence. Une récupération incluse dans la séquence se répète également après le dernier effort.
- `3 rounds 1m/1m` signifie trois rounds d'une minute, avec une minute de repos **entre** les rounds, sans repos final. `3rounds` est aussi accepté.
- `@ Z2` est une zone cible facultative, distincte du RPE après séance. Après `-`, le texte reste une consigne : « faire du 8/16 » n'est pas interprété comme des intervalles.
- Les annotations avancées ` | {…}` conservent les notes, intensités, répétitions de mouvement et autres champs non représentables dans la notation courte. La conversion ne supprime pas les champs existants pour simplifier l'affichage.

Un texte invalide reste visible avec le numéro des lignes à corriger, ne remplace pas le dernier programme valide et empêche l'enregistrement. Le graphique reflète le dernier programme valide. Le bouton de retour au dernier programme valide permet d'abandonner explicitement le brouillon invalide.

Les tuiles course et boxe présentent un petit graphique. Pour la course, la largeur représente la durée et la hauteur/couleur la zone renseignée; pour la boxe, la largeur représente la durée et la couleur le type d'atelier ou le repos, sans inventer d'intensité. Les profils partiels sont signalés; les très longues séances sont regroupées par catégorie et identifiées comme répartition, sans prétendre conserver la chronologie. L'aperçu détaillé de course propose aussi un axe distance lorsque celle-ci est renseignée.

La dernière vue **Jour / Semaine / Mois** est mémorisée par compte sur l'appareil utilisé; les aperçus locaux ont des préférences séparées. La date repart sur aujourd'hui à l'ouverture. L'indicateur **Course prévue · semaine** affiche les minutes connues du lundi au dimanche de la semaine sélectionnée, même en vue Jour ou Mois; la période est indiquée. Les kilomètres sont secondaires et n'apparaissent que si une distance a été renseignée. Aucune conversion distance/durée implicite n'est faite; les durées partielles et les totaux indisponibles sont explicitement signalés. Les autres totaux concernent tous les sports de la période affichée.

### Administration et compte athlète de test

La migration conserve les administrateurs et attribue ce statut au compte existant `mixmasterkd@gmail.com`, depuis son identité Auth de confiance. Le navigateur ne peut pas s'attribuer ce droit. L'administration liste et supprime des comptes et envoie un courriel de réinitialisation; elle ne choisit jamais le nouveau mot de passe des membres.

Le bouton **Passer en athlète de test** prépare un compte athlète dédié et lié à l'administrateur coach, puis ouvre une véritable session avec les permissions d'un athlète. La fonction serveur ne permet pas de choisir un autre membre à incarner. La session de test reste dans le stockage de l'onglet; la session habituelle de l'administrateur reste séparée. Un bandeau permet de revenir à l'administration. Cette fonction exige la nouvelle migration et la fonction serveur `admin-users` déployée; aucun compte distant n'a été créé pendant le développement.

## Architecture

L'application utilise HTML, CSS et des modules JavaScript, assemblés avec Vite. Supabase assure l'authentification et le stockage; PostgreSQL applique les permissions RLS et les droits par colonne, indépendamment de l'interface.

| Élément | Rôle |
|---|---|
| `js/app.js`, `js/calendar.js` | Calendrier, sélection de l'athlète, navigation et déplacement des séances |
| `js/domain.js`, `js/editor.js` | Blocs communs, validations, totaux et graphique de course |
| `js/program-editor.js`, `js/workout-text.js`, `css/program-editor.css` | Programme en lignes, mini-formulaires, notation texte et aide |
| `js/starter-templates.js`, `js/session-chart.js` | Kit de départ et mini-graphiques course/boxe |
| `js/session-dialogs.js`, `js/library.js` | Séances, événements, feedbacks et modèles |
| `js/auth.js`, `js/connections.js` | Connexion, inscription, invitations et permissions |
| `js/roster.js`, `js/roster-store.js`, `js/roster-attachment.js`, `js/admin.js` | Tableau commun, listes, rattachement confirmé, compatibilité du schéma et administration |
| `js/data.js`, `js/config.js` | Accès Supabase et configuration publique |
| `js/profile.js`, `js/test-session.js` | Profil personnel, gym et session athlète de test isolée |
| `js/navigation.js`, `css/theme.css`, `assets/ring-track.svg` | Navigation par rôle et identité responsive |
| `js/demo-data.js` | Aperçu fictif en mémoire, disponible uniquement en développement |
| `supabase/` | Migrations, fonction serveur et vérifications de sécurité |

Les séances partagent une structure JSON de blocs `step` et `repeat`, avec durée, distance, répétitions, rounds, travail/repos, zone, intensité, consignes et sous-blocs. Les validations limitent la profondeur à quatre niveaux, les listes à 100 blocs, le total à 200 blocs et l'expansion à 10 000 segments. Le serveur impose aussi ces bornes. Les totaux additionnent les valeurs renseignées et signalent les durées partielles; aucune conversion distance/durée implicite, analyse physiologique ou estimation de charge d'entraînement n'est effectuée. Aucun connecteur Garmin n'est inclus.

Les mises à jour ajoutent **neuf tables** : `coach_profiles`, `coach_athletes`, `training_sessions`, `personal_events`, `session_feedback`, `session_templates`, `athlete_invitations`, `gyms` et `admin_test_accounts`. Les tables existantes restent en place. Les identifiants existants sont conservés; les séances gardent le nom historique de leur auteur même si son compte est supprimé.

Les contrats RPC, la matrice d'accès et les précautions de migration sont documentés dans [supabase/README.md](supabase/README.md).

## Vérifications et limites

Les tests de base utilisent **PGlite**, un moteur PostgreSQL isolé en mémoire. Ils appliquent les migrations, reproduisent plusieurs comptes et vérifient la conservation des fiches, les refus d'accès, les invitations, les permissions, les auteurs et les suppressions. Ils ne contactent pas les vrais athlètes.

Les tests d'interface utilisent **Happy DOM** pour exercer les formulaires et les actions. Ils ne remplacent pas une vérification visuelle dans de vrais navigateurs sur ordinateur et téléphone. La livraison locale n'atteste pas d'un déploiement en production ni d'un parcours connecté validé sur la base réelle.

## Mise en production

Le déploiement reste sous le contrôle du propriétaire du projet. Le site historique est publié par GitHub Pages depuis les sources du dépôt; la nouvelle version doit publier **le contenu construit de `dist/`**, au moyen d'un déploiement Pages adapté. Pousser directement les nouvelles sources comme ancien site statique ne suffit pas : les dépendances JavaScript doivent être assemblées par Vite.

Le workflow local `.github/workflows/deploy-pages.yml` prépare cette publication sur GitHub Pages. Son lancement est **manuel uniquement** : une modification ou un push ne doit pas déclencher automatiquement la publication de l'application. Il exécute les vérifications, les tests et la compilation avant de publier `dist/`. Il ne migre pas Supabase, ne sauvegarde pas la base et ne déploie pas `admin-users`.

Avant de pousser les nouvelles sources sur la branche publiée, vérifier avec un accès propriétaire la configuration **Settings → Pages** du dépôt `mixmasterkd/gestionboxeur` et sélectionner **GitHub Actions** comme source. Le site historique utilise une publication depuis une branche : laisser ce mode actif risquerait de publier les sources non compilées lors du push. Préparer et vérifier le commit et le workflow avant d'effectuer la bascule coordonnée avec Supabase; ne pas lancer une publication tant que les prérequis de base, sauvegarde et configuration Auth ne sont pas vérifiés.

Au contrôle du 22 septembre 2026 après autorisation des intégrations, les accès GitHub et Supabase fonctionnent : compte GitHub `mixmasterkd`, projet Supabase `gestionboxeur` actif dans la région `ca-central-1`. La branche distante `main` est au commit `9226807b7bde9e6dfb06fa1ff1ce78a569aa299e`. Les journaux du dernier déploiement historique confirment une construction Jekyll depuis la racine de `main`; l'ancienne page « Crew » répond toujours sur GitHub Pages. La nouvelle version n'est pas encore publiée.

Le projet Supabase configuré est `opxsaykcofzbufzzzqwz`. L'audit initial a confirmé les trois migrations historiques et un catalogue distant identique au schéma historique local. Une sauvegarde applicative privée a été exportée hors du dépôt avant toute modification : quatre tables, avec deux profils, huit athlètes, deux réglages de gym et deux contacts, leurs définitions, droits et historique de migrations. Sa restauration puis l'application des cinq migrations sur une copie PGlite ont réussi, avec conservation des UUID, champs historiques, notes et sélections. Elle exclut les identifiants de connexion Auth et les objets Storage et ne constitue pas une sauvegarde complète de ces services.

Le correctif `secure_profile_roles` est désormais appliqué et enregistré sous sa version locale `20260921110000`. Les vérifications distantes confirment que le navigateur ne peut plus modifier `profiles.is_admin`, que le nom reste modifiable et que le déclencheur d'inscription n'est plus exécutable directement par les clients. Les deux profils et les huit athlètes sont conservés. Les quatre migrations fonctionnelles, la nouvelle fonction `admin-users` et le site Vite restent à déployer ensemble.

Les contrôles locaux de cette reprise passent : `npm run check`, les **237 tests**, `npm run build` et `git diff --check`. Les 48 références locales des pages construites sont valides et le module de démonstration est exclu de la production. Ces résultats ne remplacent pas les parcours connectés sur la base réelle. Les intégrations permettent la préparation des sources et les migrations, mais n'exposent ni le changement de source Pages, ni le lancement initial du workflow, ni la configuration des redirections Auth. Ces étapes demandent un accès aux interfaces de gestion correspondantes avant la bascule coordonnée.

La migration `20260921110000_secure_profile_roles.sql` corrige les droits administrateur tout en restant compatible avec l'ancienne interface. La migration `20260921120000_training_platform.sql` exige la nouvelle interface : les anciennes lectures globales des athlètes sont bloquées pour protéger les notes privées.

L'ordre des nouvelles migrations après les trois migrations historiques est : `20260921110000_secure_profile_roles.sql`, `20260921120000_training_platform.sql`, `20260922120000_shared_planning_and_gyms.sql`, `20260922130000_session_completion.sql`, puis `20260922140000_roster_attachment.sql`. Elles ajoutent successivement la sécurité des rôles, la planification, les gyms/profils/verrous partagés, le statut de réalisation, puis le rattachement atomique des doublons. Les séances disposant déjà d'un bilan sont marquées comme faites. La dernière migration protège aussi les notes longues contre la troncature. Les fichiers sont testés ensemble sur une base PostgreSQL isolée.

Pour une mise en ligne, prévoir une sauvegarde de la base, vérifier le projet Supabase ciblé, valider la construction et les parcours, puis **coordonner l'application de la migration principale avec la publication de `dist/`**. Déployer ensuite la fonction `admin-users` correspondante et configurer les URL de connexion et de récupération de mot de passe selon [les instructions Supabase du projet](supabase/README.md). Ne pas réinitialiser la base et ne pas rejouer les migrations historiques déjà enregistrées.
