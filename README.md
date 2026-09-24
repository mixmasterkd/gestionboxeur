# gestionboxeur

Gestion des boxeurs, listes combat/sparring, calendrier partagé et journal entre athlète et coachs. Interface sombre graphite, texte clair et accents discrets, avec le nom du gym dans l’en-tête. La navigation est latérale sur ordinateur et placée en bas sur téléphone. Les couleurs des zones d’effort conservent leur signification.

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

Le bouton **Rattacher un compte** dans le formulaire de modification d’une fiche libre propose une invitation pour une nouvelle inscription ou le rapprochement avec un compte inscrit déjà lié au coach. Aucun rapprochement automatique par nom : le coach choisit le compte et confirme qu'il s'agit de la même personne. En cas d'écart, il choisit le poids et le bilan complet (combats/victoires/défaites) à conserver, sans addition des combats. Le compte, son identité, son calendrier et ses permissions restent intacts. Les notes des deux relations sont conservées et la sélection est maintenue si l'athlète est disponible. Seule la relation à l'ancienne fiche est archivée pour ce coach; la fiche globale et les relations des autres coachs ne sont pas supprimées. Des versions périmées bloquent le rattachement et demandent une nouvelle vérification. Une fiche libre possédant déjà des données de calendrier ne peut pas être rattachée par ce parcours.

L'inscription propose **athlète par défaut**, ou coach. Pour un athlète, la date de naissance est obligatoire et l'âge est calculé. Genre M/F, poids KG/LBS, nombre de combats, victoires et défaites sont proposés; seule la date de naissance est un nouveau champ obligatoire. Les anciens profils incomplets conservent leurs données et doivent compléter la date de naissance lors de l'enregistrement de leur profil. L'athlète modifie son identité, ses coordonnées, son gym et sa disponibilité depuis `profile.html`. Ses coachs liés peuvent modifier son poids et son bilan sportif, sans changer son identité.

Le répertoire commun des gyms est sélectionnable à l'inscription. Un gym ajouté avec son adresse par un coach devient disponible immédiatement; les couples nom/adresse identiques, après normalisation des espaces et de la casse, sont réutilisés. L'administration peut ajouter ou corriger un gym. Le Crew est proposé par défaut, avec son adresse existante si elle est connue; aucune adresse n'est inventée. Choisir un gym ne donne aucun accès automatique à ses coachs.

Le coach peut créer un **lien d'invitation** valable sept jours. L'athlète s'inscrit ou se connecte avec un compte athlète, puis accepte le lien pour retrouver la fiche d'origine. Le profil automatique d'une inscription peut être remplacé uniquement s'il est encore vierge. Une fiche déjà utilisée est conservée; l'application invite alors à employer le code coach.

Un **athlète déjà connecté** peut saisir le code d'un coach. La demande reste en attente jusqu'à l'acceptation du coach. Plusieurs coachs peuvent être associés au même athlète. Celui-ci contrôle, pour chacun, l'accès au calendrier, l'ajout de séances et d'événements, la modification des éléments partagés et la lecture des retours. Retirer un coach conserve l'historique.

L'athlète et ses coachs autorisés peuvent créer des séances structurées, des événements et des notes dans le même calendrier. Un élément **déverrouillé** peut être modifié et déplacé par l'athlète et les coachs autorisés. Un élément **verrouillé** est modifiable uniquement par son créateur. Seul le créateur peut changer le verrouillage ou supprimer l'élément; ses droits d'accès doivent toujours être actifs. L'auteur d'origine reste affiché après une modification par un collaborateur. Une suppression de séance demande confirmation et supprime également son feedback.

Seul l'athlète concerné peut marquer une **séance faite** ou annuler ce statut, depuis la tuile du calendrier ou le détail de la séance, même si celle-ci est verrouillée par son coach. Aucun bilan n'est exigé pour cocher la séance. Après l'avoir cochée, il peut ouvrir le bilan facultatif pour renseigner le RPE, le ressenti et un commentaire portant sur la séance entière. Le coach voit le statut fait/à faire; l'accès au bilan reste soumis à l'autorisation de lecture des retours. Annuler le statut conserve le bilan enregistré, sans l'afficher tant que la séance n'est pas recochée.

La bibliothèque du coach propose des dossiers personnels et les dossiers **Jog - Base** et **Boxe - Base**, disponibles sans enregistrement préalable. Les bases proposent 11 jogs de 10 à 60 minutes par tranches de 5 minutes, une séance Sparring de 3 rounds de 2 minutes avec 1 minute de repos entre les rounds, et une séance Boxe fondamentale : corde 5 min, 4 rounds de shadow de 2 min avec 1 min de repos entre les rounds, 4 rounds de sac au même format, puis abdos 5 min (32 min au total). Ce sont des bases entièrement ajustables, sans prescription individualisée. Le bouton « Garder dans mes modèles » copie uniquement le modèle choisi; aucune insertion automatique des bases n'est faite dans la base.

La bibliothèque est accessible depuis le calendrier. On peut créer et renommer ses dossiers, puis y classer ses modèles. « Mes entraînements » réunit tous les modèles personnels; « Sans dossier » montre les modèles non classés. « Créer un entraînement » permet de sauvegarder un modèle sans athlète sélectionné.

Une séance ou un bloc enregistré s'utilise comme copie modifiable; supprimer un modèle ne supprime pas les séances déjà planifiées. « Garder comme modèle » est aussi disponible directement dans le formulaire de création, sans devoir planifier la séance. Un remplacement par un modèle demande confirmation si le formulaire contient déjà des informations.

Le programme propose deux vues synchronisées : **Texte**, sélectionné par défaut à gauche avec une saisie vide pour une nouvelle séance, puis **Blocs** à droite, une ligne lisible par étape. Toucher une ligne ouvre un petit formulaire; les boutons Étape, Répétition et Rounds permettent de créer des blocs sans connaître la notation. Les réglages avancés sont repliés; le champ Répétitions de mouvement est retiré, sans effacer les anciennes données. Le glisser-déposer et les commandes monter/descendre du menu de ligne restent disponibles, y compris dans les répétitions. Un formulaire de bloc doit être validé ou annulé avant d'enregistrer la séance. Dans une séance de course, les nouvelles étapes sont de la course par défaut; changer de discipline ne réécrit pas les blocs existants.

Les descriptions et notes partagées sont réunies dans la vue Texte (lignes commençant par `#`), sans champs redondants. La zone d’effort se règle sur l’effort; une nouvelle répétition ne porte pas de zone en doublon. Le sélecteur d’intensité ciblée est retiré. Les anciennes données avancées restent conservées. La saisie libre ne présente aucun exemple en filigrane ou consigne pédagogique; l’aide reste repliée.

Les notes et événements du calendrier proposent cinq couleurs pastel : sable, corail, bleu, lavande et menthe. Le choix est enregistré avec les mêmes permissions et verrous que leur contenu.

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
- Un en-tête donne le type et le nom aux étapes suivantes. `Course : Jog léger` donne un titre personnalisé. `Libre - Consigne` décrit un bloc sans durée.
- `2x` répète les étapes indentées de deux espaces. Revenir au bord gauche termine la séquence. Une récupération incluse dans la séquence se répète également après le dernier effort.
- `3 rounds 1m/1m` signifie trois rounds d'une minute, avec une minute de repos **entre** les rounds, sans repos final. `3rounds` est aussi accepté.
- `@ Z2` est une zone cible facultative, distincte du RPE après séance. Après `-`, le texte reste une consigne : « faire du 8/16 » n'est pas interprété comme des intervalles.
- Les annotations avancées ` | {…}` conservent les notes, intensités, répétitions de mouvement et autres champs non représentables dans la notation courte. La conversion ne supprime pas les champs existants pour simplifier l'affichage.

Un texte invalide reste visible avec le numéro des lignes à corriger, ne remplace pas le dernier programme valide et empêche l'enregistrement. Le graphique reflète le dernier programme valide. Le bouton de retour au dernier programme valide permet d'abandonner explicitement le brouillon invalide.

La discipline Sparring accepte une séance à consignes libres ou des rounds structurés, notamment `Sparing 3 rounds 2m/1m`, avec sa couleur dans le graphique.

Les tuiles course, boxe et sparring présentent un petit graphique. Pour la course, la largeur représente la durée et la hauteur/couleur la zone renseignée; pour la boxe, la largeur représente la durée et la couleur le type d'atelier ou le repos, sans inventer d'intensité. Les profils partiels sont signalés; les très longues séances sont regroupées par catégorie et identifiées comme répartition, sans prétendre conserver la chronologie. L'aperçu détaillé de course propose aussi un axe distance lorsque celle-ci est renseignée.

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
| `js/starter-templates.js`, `js/session-chart.js` | Séances de base et mini-graphiques course/boxe |
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

**Dernière publication — 23 septembre 2026 (Toronto)** : refonte Arena et correctif du compte athlète de test, commit `025b9e79636041458ab2cf3f0a7b8d9cbe34191c`, [workflow réussi](https://github.com/mixmasterkd/gestionboxeur/actions/runs/35953117413). La fonction `admin-users` est maintenant active en **version 4**, avec `verify_jwt=true`. Les 241 tests, les contrôles de sources et les contrôles de CSS compilé passent. Les six pages et douze fichiers CSS/JS publics correspondent exactement à l'artefact publié. Aucune migration supplémentaire, aucun compte créé et aucun courriel envoyé. Le [bilan d'audit](AUDIT.md) détaille les corrections et les limites de la validation visuelle et connectée. Les paragraphes suivants conservent l'historique de la première mise en production.

Le site est publié sur **https://mixmasterkd.github.io/gestionboxeur/**. Le [déploiement du 22 septembre 2026](https://github.com/mixmasterkd/gestionboxeur/actions/runs/35813653825) (heure de Toronto) a réussi à partir du commit applicatif `83ec666fa5ef908b1a73fab1af9ba37595cc6e74`, intégré par la [PR #1](https://github.com/mixmasterkd/gestionboxeur/pull/1). GitHub Pages utilise désormais **GitHub Actions** et HTTPS, avec publication du contenu compilé de `dist/`.

Le workflow `.github/workflows/deploy-pages.yml` reste **manuel uniquement**, sur `main`, avec `backend_ready=true`. Il exécute `npm ci`, les contrôles, les tests et la compilation avant publication. Un push seul ne publie pas le site. Ce workflow ne sauvegarde pas Supabase, ne migre pas la base et ne déploie pas `admin-users`.

Le projet Supabase est `opxsaykcofzbufzzzqwz` (`gestionboxeur`, région `ca-central-1`). Les trois migrations historiques et les cinq nouvelles sont enregistrées avec les mêmes versions que les fichiers locaux. La fonction `admin-users` est active en version 3, avec `verify_jwt=true` et une validation supplémentaire du compte et de ses droits administrateur dans son code. Sa dépendance `supabase-js` est épinglée à `2.116.0`.

Une sauvegarde applicative privée a été exportée hors du dépôt avant modification : quatre tables, leurs définitions, droits et historique de migrations. Sa restauration et l'application des cinq migrations sur une copie PGlite ont réussi. Après la migration réelle, les deux profils, huit athlètes, deux réglages de gym et deux contacts sont conservés : 194 valeurs historiques comparées, UUID et notes préservés, huit relations coach–athlète reprises. Cette sauvegarde exclut les identifiants de connexion Auth et les objets Storage ; elle ne constitue pas une sauvegarde complète de ces services.

Les URL Auth sont configurées avec `https://mixmasterkd.github.io/gestionboxeur/` comme Site URL et `https://mixmasterkd.github.io/gestionboxeur/**` pour les redirections de l'application. Des requêtes avec un jeton volontairement invalide ont vérifié les destinations de confirmation, de récupération et d'invitation, ainsi que le refus d'une destination externe. Aucun courriel ni compte de test n'a été créé pour ces contrôles.

La vérification locale après installation propre et le workflow distant ont réussi : **237 tests**, contrôle des sources et build. Les six pages HTML et leurs douze fichiers JavaScript/CSS répondent en HTTP 200 et correspondent exactement à l’artefact publié par GitHub Actions. Les contrôles SQL distants confirment les 13 tables sous RLS, les droits sensibles protégés, les RPC et déclencheurs attendus, le gym par défaut et la reprise des relations. Les requêtes publiques sans session sont refusées sur les séances et sur l'administration. Ces contrôles ne remplacent pas un parcours complet connecté dans un navigateur avec un compte réel.

Les advisories Supabase ne signalent plus de fonction privilégiée accessible anonymement ni de `search_path` manquant. Les avis sur les RPC accessibles aux utilisateurs authentifiés et sur la table d'invitations réservée aux RPC correspondent au modèle d'accès prévu. L'avis préexistant [protection des mots de passe compromis désactivée](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) reste présent.

Pour les prochaines mises en ligne, conserver une sauvegarde adaptée, vérifier le projet ciblé et son historique, puis appliquer uniquement les nouvelles migrations. Ne pas réinitialiser la base et ne pas rejouer celles déjà enregistrées. Ne pas revenir à l'ancienne interface historique : ses lectures globales des athlètes sont incompatibles avec les protections des notes privées. Les [instructions Supabase](supabase/README.md) détaillent les contrats et les vérifications.


### Règles de rédaction de l’interface

Aucun slogan ni accroche promotionnelle. Les champs de saisie ne contiennent aucun exemple en filigrane ou prérempli; leurs libellés identifient leur fonction. Les exemples de notation restent dans l’aide repliée. Les valeurs de données existantes et les entraînements choisis dans la bibliothèque restent affichés normalement.


### Compte unique et calendrier personnel

L’inscription crée un compte personnel, sans choix athlète/coach. Dans Mon profil, « Activer les fonctions coach » ajoute les outils d’encadrement au même compte; les coachs existants les conservent. Chaque compte possède son propre profil sportif et calendrier. Le calendrier du coach apparaît sous « Mon calendrier » avant ses athlètes. Mon profil réunit ses renseignements sportifs et les coordonnées de son gym.

Dans les connexions, les coachs ont deux vues : Mes athlètes (code et demandes à accepter) et Mes coachs (code d’un autre coach, demande et permissions personnelles). Pour relier deux comptes existants : saisir le code dans Mes coachs, puis faire accepter la demande par l’autre coach. Les permissions portent sur la personne encadrée, jamais automatiquement sur ses propres athlètes. Les liens d’invitation vers une fiche sans compte restent disponibles et refusent toute fusion qui effacerait un profil déjà utilisé.

Le compte athlète de test reste distinct, lié au même administrateur, avec son historique et le retour vers Administration. L’activation des fonctions coach y est bloquée pour conserver ce rôle de test. Les profils personnels des anciens coachs sont créés sans inventer de date de naissance; compléter Mon profil permet de renseigner ces informations.

Techniquement, `account_type` est conservé pour compatibilité : `coach` signifie que les fonctions d’encadrement sont actives. Ce n’est plus un choix exclusif entre deux identités. `enable_coaching()` ne peut activer que le compte connecté, ne donne aucun droit administrateur et préserve les identifiants et l’historique.

### Journal

Le journal est indépendant des notes du calendrier, accessible depuis la navigation. Deux vues présentent les mêmes sujets et suivis : **Kanban** et **Chronologie**, sans pièces jointes ni gestion de liens. Les colonnes sont **À explorer / En travail / À entretenir**; le statut se change dans le détail d’un sujet ou en glissant sa tuile par la poignée vers une autre colonne. Les archives restent consultables sans glisser-déposer. Aucun statut « Acquis » ou fin définitive. La recherche retrouve sujets, textes et commentaires; l’archivage conserve tout l’historique et permet une réactivation.

Chaque personne peut tenir son journal. Les coachs ayant accès à son calendrier peuvent le consulter; ceux autorisés à ajouter des séances peuvent aussi créer des sujets, ajouter leurs conseils et changer les statuts. Chacun peut modifier uniquement son propre texte. Les auteurs et l’historique des changements sont enregistrés côté serveur. Les notes privées du coach restent une demande distincte, pas encore implantée.

La migration `20260924143701_journal_and_library_folders.sql` ajoute le journal et les dossiers privés de bibliothèque. Les règles RLS et les droits par colonne protègent la lecture, l’attribution des auteurs et les suivis; aucun effacement de journal n’est proposé. Un premier sujet marque le profil comme utilisé, empêchant son remplacement par une invitation.

### Groupes — à discuter

Proposition : plusieurs groupes par coach, appartenances multiples, calendrier commun synchronisé dans les calendriers personnels, suivi individuel et petit symbole de groupe sur la tuile, avec son nom dans le détail; aucune étiquette « Personnel ». Les détails de visibilité, d’arrivée/départ et d’adaptation individuelle restent à valider. Les groupes ne sont pas implantés.

### Navigation du calendrier et palette graphite

Le bouton Changer ouvre une liste de calendriers avec recherche (accents facultatifs), défilement interne et fermeture après sélection. Le nombre d’athlètes ne modifie pas la hauteur de l’en-tête. La période et la vue sont conservées au changement de calendrier. La coche de réalisation est directement sur la tuile du propriétaire du calendrier, y compris en vue Mois sur mobile; le titre ouvre toujours les détails. Les droits de réalisation restent inchangés.

Palette sombre graphite par défaut, texte clair, accents ardoise discrets. Un bouton soleil/lune dans la barre du haut bascule vers le mode clair et mémorise le choix sur l’appareil pour toutes les pages. Les couleurs des efforts et les notes pastel conservent leur sens. Les deux thèmes sont limités à l’écran pour préserver les listes imprimées sur fond blanc.


Sur mobile, les athlètes apparaissent en cartes compactes : nom et sélection, quatre renseignements côte à côte, puis statut et Modifier. Un sélecteur de tri remplace les en-têtes de colonnes. Le nom d’un athlète ayant partagé son calendrier ouvre directement ce calendrier; les autres noms ouvrent leur fiche. Rattacher se trouve uniquement dans la fiche, avec protection des modifications non enregistrées.


La préparation d’une liste s’ouvre sur Sparring, placé avant Combat. Le type de liste et les unités de poids partagent des boutons à état sélectionné explicite (contraste et coche), lisibles dans les deux thèmes. Les coachs contacts utilisent les surfaces et textes du thème actif.
