# gestionboxeur

Gestion des boxeurs, listes combat/sparring et calendrier partagé entre athlète et coachs. Interface sportive vert profond, ivoire et citron, avec le nom du gym dans l'en-tête. La navigation est latérale sur ordinateur et placée en bas sur téléphone. **Explorer** ouvre une carte des rubriques en perspective, avec un léger mouvement au pointeur sur ordinateur et de grandes cartes verticales sur téléphone. Les liens habituels restent disponibles. Les effets respectent la préférence de réduction des animations; aucune bibliothèque 3D, police distante ou boucle d'animation permanente n'est ajoutée. Les couleurs des zones d'effort conservent leur signification.

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

La planification connectée exige les migrations jusqu'à `20260922130000_session_completion.sql`, et le rattachement de doublons exige `20260922140000_roster_attachment.sql`. **Les huit migrations sont appliquées sur le projet distant et la nouvelle interface est publiée depuis le 22 septembre 2026 (heure de Toronto).** La fonction `admin-users` version 3 est active. Sur un autre projet utilisant encore le schéma historique, l'application conserve l'accès aux listes et bloque la planification et les inscriptions athlètes jusqu'à sa mise à jour.

```bash
npm run check
npm test
npm run build
npm run preview
```

- `check` vérifie la syntaxe JavaScript, les identifiants HTML, les dialogues accessibles et les balises mobiles.
- `test` vérifie les dates, les calculs de blocs, les parcours d'interface et les protections entre comptes.
- `build` produit le site statique dans `dist/` puis vérifie les styles compilés des cinq pages à 375 et 1280 px; `preview` permet de consulter cette construction localement. Chaque famille de pages possède une entrée CSS ordonnée (`account-page.css`, `planning-page.css`, `roster-page.css`) pour empêcher l'extraction des styles partagés de remettre les anciennes règles après le thème.

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

Le site est publié sur **https://mixmasterkd.github.io/gestionboxeur/**. Le [déploiement du 22 septembre 2026](https://github.com/mixmasterkd/gestionboxeur/actions/runs/35813653825) (heure de Toronto) a réussi à partir du commit applicatif `83ec666fa5ef908b1a73fab1af9ba37595cc6e74`, intégré par la [PR #1](https://github.com/mixmasterkd/gestionboxeur/pull/1). GitHub Pages utilise désormais **GitHub Actions** et HTTPS, avec publication du contenu compilé de `dist/`.

Le workflow `.github/workflows/deploy-pages.yml` reste **manuel uniquement**, sur `main`, avec `backend_ready=true`. Il exécute `npm ci`, les contrôles, les tests et la compilation avant publication. Un push seul ne publie pas le site. Ce workflow ne sauvegarde pas Supabase, ne migre pas la base et ne déploie pas `admin-users`.

Le projet Supabase est `opxsaykcofzbufzzzqwz` (`gestionboxeur`, région `ca-central-1`). Les trois migrations historiques et les cinq nouvelles sont enregistrées avec les mêmes versions que les fichiers locaux. La fonction `admin-users` est active en version 3, avec `verify_jwt=true` et une validation supplémentaire du compte et de ses droits administrateur dans son code. Sa dépendance `supabase-js` est épinglée à `2.116.0`.

Une sauvegarde applicative privée a été exportée hors du dépôt avant modification : quatre tables, leurs définitions, droits et historique de migrations. Sa restauration et l'application des cinq migrations sur une copie PGlite ont réussi. Après la migration réelle, les deux profils, huit athlètes, deux réglages de gym et deux contacts sont conservés : 194 valeurs historiques comparées, UUID et notes préservés, huit relations coach–athlète reprises. Cette sauvegarde exclut les identifiants de connexion Auth et les objets Storage ; elle ne constitue pas une sauvegarde complète de ces services.

Les URL Auth sont configurées avec `https://mixmasterkd.github.io/gestionboxeur/` comme Site URL et `https://mixmasterkd.github.io/gestionboxeur/**` pour les redirections de l'application. Des requêtes avec un jeton volontairement invalide ont vérifié les destinations de confirmation, de récupération et d'invitation, ainsi que le refus d'une destination externe. Aucun courriel ni compte de test n'a été créé pour ces contrôles.

La vérification locale après installation propre et le workflow distant ont réussi : **237 tests**, contrôle des sources et build. Les six pages HTML et leurs douze fichiers JavaScript/CSS répondent en HTTP 200 et correspondent exactement à l’artefact publié par GitHub Actions. Les contrôles SQL distants confirment les 13 tables sous RLS, les droits sensibles protégés, les RPC et déclencheurs attendus, le gym par défaut et la reprise des relations. Les requêtes publiques sans session sont refusées sur les séances et sur l'administration. Ces contrôles ne remplacent pas un parcours complet connecté dans un navigateur avec un compte réel.

Les advisories Supabase ne signalent plus de fonction privilégiée accessible anonymement ni de `search_path` manquant. Les avis sur les RPC accessibles aux utilisateurs authentifiés et sur la table d'invitations réservée aux RPC correspondent au modèle d'accès prévu. L'avis préexistant [protection des mots de passe compromis désactivée](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) reste présent.

Pour les prochaines mises en ligne, conserver une sauvegarde adaptée, vérifier le projet ciblé et son historique, puis appliquer uniquement les nouvelles migrations. Ne pas réinitialiser la base et ne pas rejouer celles déjà enregistrées. Ne pas revenir à l'ancienne interface historique : ses lectures globales des athlètes sont incompatibles avec les protections des notes privées. Les [instructions Supabase](supabase/README.md) détaillent les contrats et les vérifications.
