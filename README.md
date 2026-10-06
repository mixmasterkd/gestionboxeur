# GBoxeur

Gestion des boxeurs, listes combat/sparring, calendrier partagé et journal entre athlète et coachs. Interface sombre graphite, texte clair et accents discrets, avec le nom du gym dans l’en-tête. La navigation est latérale sur ordinateur et placée en bas sur téléphone. Les couleurs des zones d’effort conservent leur signification.

Le nom de l’application est **GBoxeur**; le nom technique du dépôt reste **gestionboxeur**. Le nom du gym demeure une donnée personnalisable. Le projet de référence est ce dossier `gestionboxeur/`; les anciennes pages et copies de scripts dans le dossier parent ne font pas partie de la construction Vite.

## Installation sur téléphone

**Installer GBoxeur** est un lien discret sous la connexion, à côté des actions de compte, et se trouve dans la section **Application** de **Mon profil**. Cette action ouvre l’invitation native si le navigateur la propose, sinon les instructions adaptées. La section disparaît dans l’application installée. Sur iPhone, ouvrir dans Safari puis **Partager → Ajouter à l’écran d’accueil** (activer « Ouvrir comme app web » si proposé). Sur Android, utiliser l’invitation ou **Installer l’application / Ajouter à l’écran d’accueil** dans le menu du navigateur.

L’icône reprend exactement le logo du site, exporté aux tailles 180, 192 et 512 pixels sur fond clair. Le manifeste commun aux sept pages ouvre le calendrier en fenêtre autonome avec le nom **GBoxeur**, sans changer l’adresse GitHub Pages ni les noms des gyms. Aucune orientation n’est imposée.

**Connexion Internet requise : aucun service worker ni cache hors connexion n’est ajouté.** La session reste gérée par le parcours de connexion existant; selon l’appareil, la première ouverture de l’app installée peut demander de se reconnecter. Les timers demandent le maintien de l’écran allumé pendant leur exécution, repos compris, puis le libèrent à la pause ou à la fin. Après un retour sur la page, ils redemandent cette protection. Le navigateur, le mode économie d’énergie ou un verrouillage manuel peuvent la refuser; les signaux en arrière-plan ne sont pas garantis.

Références : [installation web sans obligation de service worker](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [limites du maintien d’écran](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).

## Démarrage local

Prérequis : **Node.js 22.12 ou plus récent** et npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Ouvrir l'adresse indiquée par Vite. `.env.local` configure `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`. La clé publique fournie est destinée au navigateur; une clé `service_role` ne doit jamais apparaître dans une variable `VITE_*`.

L’accueil (`index.html`) et la connexion ouvrent le calendrier (`planning.html`). Le répertoire des athlètes et les listes sont dans `roster.html`. Les anciens liens `?liste=1` restent compatibles. Le menu commence par Calendrier, Journal, Athlètes; les paramètres sont accessibles dans Mon profil. Le libellé court « Athlètes » évite la superposition sur mobile, sans renommer le titre de la page.

### Aperçu sans compte ni données réelles

Avec `npm run dev`, ouvrir `http://127.0.0.1:5173/planning.html?demo=coach` ou `http://127.0.0.1:5173/planning.html?demo=athlete`. Ces aperçus permettent de créer, modifier, verrouiller et déplacer des séances fictives, essayer les blocs et les graphiques, et ajouter des événements. Tout reste en mémoire et se réinitialise au rechargement. Les liens vers les profils, les listes ou l'administration rejoignent le véritable parcours connecté. L'aperçu est exclu de la construction de production; il ne remplace pas le compte athlète de test connecté.

Les fiches, sélections, contacts et listes fonctionnent avec le schéma Supabase historique et le nouveau schéma. Le mode historique n'est activé qu'en cas d'absence confirmée du nouveau schéma, jamais pour contourner une erreur de permission ou de connexion.

La planification connectée exige les migrations jusqu'à `20260922130000_session_completion.sql`, et le rattachement de doublons exige `20260922140000_roster_attachment.sql`. **Les 24 migrations sont appliquées sur le projet distant, y compris les sauvegardes privées des timers, du babillard et des records cognitifs (1er octobre 2026).** La fonction `admin-users` version 4 est active. Sur un autre projet utilisant encore le schéma historique, l'application conserve l'accès aux listes et bloque la planification et les inscriptions athlètes jusqu'à sa mise à jour.

```bash
npm run check
npm test
npm run build
npm run preview
```

- `check` vérifie la syntaxe JavaScript, les identifiants HTML, les dialogues accessibles et les balises mobiles.
- `test` vérifie les dates, les calculs de blocs, les parcours d'interface et les protections entre comptes.
- `build` produit le site statique dans `dist/` puis vérifie les styles compilés des pages à 375 et 1280 px; `preview` permet de consulter cette construction localement. Chaque famille de pages possède une entrée CSS ordonnée (`account-page.css`, `planning-page.css`, `roster-page.css`) pour empêcher l'extraction des styles partagés de remettre les anciennes règles après le thème.

## Groupes et outils

Les groupes se gèrent dans **Mes athlètes → Groupes** : nom, membres et suppression. Le profil personnel du coach figure sous son propre nom dans la sélection, avec les comptes athlètes associés qui autorisent la planification. Le menu **Changer** distingue Athlètes et Groupes; un calendrier de groupe affiche uniquement ses séances et notes communes.

La création de séance propose un champ **Destinataires** : une personne, plusieurs personnes, des groupes, ou une sélection mixte. Une personne sélectionnée plusieurs fois ne reçoit qu’une séance. Une seule personne sans groupe conserve une séance individuelle; une sélection collective produit un contenu commun géré par son auteur, avec une réalisation et un bilan propres à chaque athlète. Ajouter un membre attribue les séances à venir; le retrait enlève seulement les séances à venir non réalisées, sans bilan, sans autre source d’attribution et pour lesquelles le coach conserve le droit de modification. Les séances passées et les bilans sont conservés. Les comparaisons de dates de cette règle utilisent le jour courant de la base de données.

L’entrée **Outils** ouvre les timers de boxe et à intervalles, les compteurs de coups bleu/rouge à appuis simultanés, le compteur manuel de pas par minute, le babillard et les jeux cognitifs. Les timers proposent pause, reprise, plein écran et signaux sonores; le timer de boxe mémorise le choix Moderne/Classique. Garder la page ouverte pour les signaux; le maintien de l’écran dépend du navigateur. L’aperçu local est disponible sur `tools.html?demo=coach` ou `tools.html?demo=athlete`.

**Jeux cognitifs** ouvre un menu de cinq cartes : **Tuiles**, **Sac**, **Mémoire visuelle**, **Test de réactivité** et **Double Tâche**. Le test de réactivité se trouve désormais dans ce menu. Tuiles et Sac sont deux jeux distincts, accessibles uniquement depuis ce menu : **Tuiles** (6 par défaut, ou 4/8) et **Sac**. Les tuiles affichent uniquement leur couleur, avec une note sonore distincte et facultative. Une séquence s’allonge à chaque réussite; le score correspond à la dernière séquence entièrement reproduite. Le sac 3D procédural possède du cuir texturé, des coutures, des chaînes et six zones usées fixes. Ses numéros au feutre sont sur des rubans blancs : désactiver **Numéros** retire aussi les rubans, sans déplacer les zones. En **Séquence**, les chiffres apparaissent au-dessus du sac, sans éclairer les réponses. En **Cibles**, toucher la cible éclairée pendant 30 secondes rapporte un point; une erreur retire un point, sans descendre sous zéro. Le sac oscille légèrement au toucher; les sons sourds sont facultatifs. Une vue simplifiée conserve les commandes sans WebGL.

Les records cognitifs sont privés au compte et séparés en sept variantes (4/6/8 tuiles, Séquence et Cibles avec/sans numéros). La base conserve atomiquement le meilleur score, même entre appareils. **Recommencer** ne touche pas au record; **Effacer ce record** demande confirmation et ne supprime que la variante affichée. Une partie arrêtée ou interrompue par le passage en arrière-plan ne valide pas de record. Une erreur réseau reste visible avec possibilité de réessayer; il n’y a pas de remplacement silencieux par un record local. En aperçu, les records restent en mémoire seulement. Les réglages sont mémorisés localement par compte. Le maintien d’écran est demandé pendant la partie et libéré à l’arrêt; la 3D est chargée à la demande et libérée en quittant l’outil.

Le choix de couleur d’une note du babillard utilise uniquement des pastilles, sans nom de couleur visible; les noms restent disponibles pour les lecteurs d’écran.

Le **Babillard** ajoute un cadre 3D procédural (Three.js, sans Blender), du liège texturé, des feuilles courbées et des punaises. Ses textes et liens sont en HTML accessible; une vue CSS prend le relais sans WebGL. Trois notes initiales regroupent la FQBO, son calendrier, le guide du premier combat, les règles de Boxe Canada (document 2025) et les formulaires médicaux annuel/précombat. Chaque compte peut ajouter, modifier, déplacer et retirer ses propres notes. Les liens sont limités à HTTP/HTTPS. Les notes sont privées au compte, non partagées avec le gym. Les modifications sont enregistrées au serveur; une erreur garde les notes affichées et avertit avant de quitter. La 3D est chargée seulement à l’ouverture, rendue à la demande, limitée en résolution et libérée à la fermeture.

En bas du timer à intervalles, **Enregistrer / Charger** donnent accès aux réglages privés du compte. Une sauvegarde contient son titre et uniquement le mode affiché : configuration et unités M/S de Base, ou texte d’Avancé. Charger active le bon mode et conserve le brouillon de l’autre; aucune progression de chrono n’est enregistrée. La suppression par × demande confirmation. Ces commandes sont verrouillées pendant un timer en cours ou en pause. En aperçu `?demo=…`, notes et timers restent seulement en mémoire jusqu’au rechargement; aucun appel de sauvegarde distant n’est fait.

Sur le timer classique, la **vis inférieure droite du boîtier** active la rotation au glissement (souris ou toucher). Les bascules Round, Repos et Marche/Pause gardent la priorité sur la rotation; les durées restent verrouillées pendant un chrono en cours ou en pause. Glisser ailleurs fait tourner le boîtier. Les flèches du clavier tournent aussi le boîtier; Maj augmente le pas. La même vis physique, ou Échap, rebloque la rotation et remet la face avant. Sa zone tactile invisible suit le modèle et disparaît derrière lui : aucune vis flottante ni aide ne recouvre la vue. Au dos, un post-it porte l’adresse manuscrite `mixmasterkd.github.io/BoxeurDeux-D`, volontairement non cliquable. Aucun mouvement continu automatique n’est imposé.

Le compteur de coups possède un bouton **Round suivant** : il archive les deux scores avec leur couleur, puis commence le round suivant à zéro. L’historique et le round en cours restent en mémoire lors d’un changement d’outil, jusqu’au rechargement de la page. **Remettre à zéro** efface tous les rounds et revient au round 1.

Le timer de boxe moderne affiche un fond vert pendant le round, jaune durant les 30 dernières secondes si l’avertissement est activé, rouge au repos et noir en préparation. Le classique affiche un véritable boîtier 3D Three.js, construit dans `js/classic-timer-scene.js`, avec le logo du site et trois lampes synchronisées aux dômes courts et arrondis. Trois boutons à bascule sont alignés sur la façade : Marche/Pause, Round et Repos. Les deux derniers alternent leurs durées au clic; un glissement horizontal choisit aussi leur position. Leur inclinaison physique suit le réglage. Les bascules, les commandes −/+ et les réglages habituels restent accessibles au clavier et au toucher. Les durées restent verrouillées jusqu’à la réinitialisation. Le rendu 3D est chargé à la demande, limité en résolution et actualisé seulement quand nécessaire; une vue simplifiée conserve le timer si WebGL est indisponible. La cloche synthétisée dans `js/timer-audio.js` sonne trois fois aux transitions de round; l’avertissement est plus court et discret. Aucun fichier audio ni service externe supplémentaire n’est nécessaire.

Le classique dispose les lampes **vert, jaune, rouge** de gauche à droite. La boxe propose un seul sélecteur de rounds : **Infini**, puis **1 à 99** (préparation une seule fois en mode infini). Sa valeur technique 0 n’est jamais affichée; les préférences existantes restent compatibles. Les quatre réglages sont alignés sur deux rangées, avec les unités courtes **min/sec**. Les intervalles simples ajoutent des séries et un repos entre séries : celui-ci remplace le dernier repos ordinaire et aucun repos n’est ajouté après la séance. Le travail est vert par défaut, les repos gris; la préparation et la fin restent noires.

Le timer à intervalles réunit **Base** et **Avancé** dans un seul panneau à deux onglets. En Base, chaque durée a ses boutons discrets **M/S** indépendants; changer d’unité conserve les secondes réelles (90 S = 1,5 M). Les répétitions, séries, unités et durées sont mémorisées. Les signaux de l’intervalle sont des bips, tandis que la boxe conserve sa cloche.

Dans **Avancé**, le texte est directement accessible, sans case d’activation, aide, aperçu de commandes reconnues ni import calendrier. Il reproduit le programme de Base jusqu’à la première modification manuelle; ensuite les deux modes restent indépendants. Revenir à Base retrouve les réglages précédents sans effacer le texte. Démarrer utilise le mode sélectionné. Le brouillon avancé et le mode sélectionné sont sauvegardés localement par compte, sans synchronisation entre appareils. Les anciens brouillons personnalisés sont conservés.

Les commandes acceptent la syntaxe des entraînements (`3x`, `3 rounds`, `- 1m @ Z3`, `- 30s @ Repos`, minutes `'` et secondes `"`). La préparation peut être écrite explicitement en première ligne (`- 5s @ Préparation`). Une ligne vide sépare les groupes. Chaque groupe répète toutes ses étapes, y compris un repos final explicitement écrit, sans en ajouter. Zones, plages de zones, RPE et autres intensités reprennent la palette du graphique (Z3 vert, Z4 orange); la phase actuelle et la suivante sont affichées. Distances ou mouvements sans durée et commandes invalides bloquent le départ avec une explication. Les programmes de Base dépassant les limites de conversion du texte restent jouables en Base.

Les notes peuvent également être attribuées à un groupe ou à plusieurs personnes : leur auteur gère le contenu commun. L’ajout d’un membre lui attribue les notes à venir ou encore en cours. Le retrait d’un membre conserve les notes déjà commencées et retire les notes futures sans autre source d’attribution, tant que les droits de modification existent. Les notes communes sont partagées et verrouillées; les notes individuelles gardent leurs réglages indépendants de confidentialité et de verrouillage.

Les ouvertures de création de séance, sujet du journal et sélection du calendrier ciblent un titre neutre sur mobile : le clavier apparaît en touchant un champ. Les cartes de séance utilisent une fine bande colorée. L’éditeur propose un menu de pastilles pour les couleurs de texte, avec quatre pastels, six couleurs de base et le retour à la couleur normale. Les notes s’adaptent au contenu avec un aperçu de texte compact; seul un élément verrouillé affiche un cadenas. Chaque journée contient un seul bouton **+**, ouvrant **Bibliothèque**, **Planifier une séance** et **Notes** avec la date et le calendrier choisis. Les boutons en haut du calendrier restent accessibles.

**Activation des groupes sur une base connectée :** appliquer les migrations `20260930183034_training_groups.sql`, `20260930191243_shared_calendar_notes.sql` et `20260930191446_workout_text_base_colors.sql`, dans cet ordre, avant de publier cette version. Elles ont été testées avec PGlite puis appliquées au projet distant le 30 septembre 2026, après sauvegarde et vérification des données existantes. Sur une base où ces migrations sont absentes, la planification individuelle reste disponible et les groupes indiquent leur indisponibilité. L’aperçu de planification contient un groupe fictif et les mutations restent en mémoire.

## Test de réactivité

Le **Test de réactivité** est accessible dans **Outils → Jeux cognitifs**. Il est publié sur GitHub Pages depuis le 5 octobre 2026 et conserve ses records privés. L’aperçu `tools.html?demo=coach` ou `tools.html?demo=athlete` reste réservé au développement local.

Trois niveaux sont proposés :

- **Réaction simple** : un bouton, à toucher seulement lorsque sa couleur apparaît.
- **Repérage** : quatre boutons; la couleur annoncée apparaît sur un seul d’entre eux.
- **Choix** : quatre boutons, quatre couleurs; toucher uniquement la couleur annoncée.

Choisir **1 coup**, **5 coups** (par défaut) ou **10 coups**, puis **Démarrer**. Chaque coup commence après une attente variable. Un appui trop tôt, une mauvaise cible, plusieurs appuis simultanés ou l’absence de réponse sont des erreurs, exclues du meilleur temps et de la moyenne valide. Les résultats restent visibles coup par coup. Au clavier, utiliser **Espace** en mode simple; **A / K / Z / M** correspondent aux quatre positions, de gauche à droite puis de haut en bas. Relâcher les commandes entre les coups; maintenir une touche ou un doigt ne permet pas d’anticiper le prochain signal.

Les records personnels conservent le plus petit temps valide, séparément pour chaque niveau et chaque commande (**Tactile**, **Souris**, **Clavier**), soit neuf variantes indépendantes. Le sélecteur **Commande** permet de consulter chacune d’elles; la commande réellement utilisée détermine le record enregistré. Un coup valide peut améliorer le record sans attendre la fin de toute la série. **Recommencer** ne l’efface pas; **Effacer ce record** demande confirmation et ne concerne que la variante affichée. Les réglages restent locaux au compte; les records connectés utilisent leur stockage privé, avec une erreur visible et **Réessayer** en cas d’échec, sans remplacement silencieux par un record local. En aperçu, ils restent seulement en mémoire jusqu’au rechargement.

**Arrêter**, quitter la page ou passer en arrière-plan interrompt la série et abandonne le coup encore en cours, sans retirer les records déjà validés. Le maintien de l’écran est demandé pendant la série, selon les possibilités du navigateur. Le chronométrage commence à l’apparition effective du signal, sur une boucle d’affichage indépendante du timer de boxe; aucune transition de couleur ne retarde le signal. Les millisecondes restent une mesure pratique dépendant de l’écran, de la commande et du navigateur, pas une mesure clinique ni une comparaison équitable entre appareils.

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

## Jeux cognitifs et mode séance

Les comptes connectés utilisent leur stockage privé sur Supabase pour les records. En développement, ouvrir `http://127.0.0.1:5173/tools.html?demo=athlete` ou `?demo=coach` avec `npm run dev` permet de tout essayer sans compte ni données réelles. Les deux nouveaux jeux enregistrent alors explicitement leurs records dans `localStorage`, sous une clé propre au compte d’aperçu ou au compte connecté. Ce stockage de développement ne constitue pas un remplacement silencieux d’une sauvegarde distante.

Dans **Outils → Jeux cognitifs**, les cinq cartes donnent accès aux jeux; chaque nouveau jeu dispose d’un retour au menu, d’une courte introduction, d’un bouton Commencer/Rejouer et d’un résultat. Pendant une partie, la zone de jeu occupe l’écran, sans défilement, en portrait et paysage. Les parties quittées, arrêtées ou interrompues ne sont pas enregistrées.

- **Mémoire visuelle** : grille 6 × 6, trois vies pour la partie entière, réponses dans n’importe quel ordre. Niveau 1 : trois cases pendant 2,8 s. Une case supplémentaire tous les deux niveaux, jusqu’à seize; exposition diminuée de 0,1 s par niveau jusqu’à 0,8 s. Trente niveaux maximum. Une mauvaise case coûte une vie; retoucher une case déjà sélectionnée n’ajoute rien. Le record correspond au dernier niveau entièrement réussi, distinct du niveau atteint lors de l’échec.
- **Double Tâche** : trente stimuli, dont huit à douze triangles, avec positions aléatoires, durées de 750 à 1 150 ms et intervalles de 220 à 600 ms. Le comptage reste caché jusqu’à la réponse finale. Un cercle réussi rapporte 10 points et un bonus `arrondi(10 × max(0, 1 − temps_ms / 1000))`. Un cercle manqué retire 10 points; un triangle touché retire 15 points; chaque unité d’écart dans la réponse finale retire 10 points. Le score final reste supérieur ou égal à zéro. La précision de comptage est `max(0, arrondi(100 × (1 − écart / triangles)))`. Les temps moyens et meilleurs concernent uniquement les cercles réussis; sans réussite ils restent absents, jamais à zéro.
- **Sauvegardes** : pour chacun des deux nouveaux jeux, le meilleur résultat et le dernier résultat complet sont conservés avec leur date et toutes les statistiques du prompt. Les records des jeux historiques conservent leur mécanisme existant. En production, les nouveaux résultats utilisent la table privée `cognitive_records` et le RPC `save_cognitive_result`. Aucun historique de toutes les parties n’est ajouté.
- **Timers conventionnels** : le bouton ⛶ dans l’affichage ouvre le mode séance, couleur et chiffres sur toute la surface. Une séance en cours ou en pause s’y verrouille automatiquement. Maintenir le cadenas 3 s, avec progression visible, rend les commandes accessibles sans arrêter le chrono. Relâcher trop tôt annule; le relâchement ne déclenche aucune commande. Reprendre le timer reverrouille les commandes. Réduire l’affichage conserve la progression. Réinitialiser agit immédiatement sur tous les timers, dès que les commandes sont déverrouillées, sans confirmation. Le boîtier classique 3D ne reçoit pas le mode séance. Sons et maintien d’écran réutilisent les mécanismes existants.

La migration locale `20261006024812_cognitive_memory_dual_task.sql` est appliquée au projet distant sous la version `20261006033329`, après autorisation de mise en ligne. Elle étend la table des records existante et ajoute un RPC privé pour le meilleur et le dernier résultat. Ne pas la rejouer sous son horodatage local. Les 196 lignes des 30 tables préexistantes sont conservées; les essais distants de sauvegarde et de permissions ont été annulés par transaction. La PWA conserve son fonctionnement actuel : aucune nouvelle mise en cache hors ligne de l’application.

Fichiers créés : `js/cognitive-menu.js`, `js/mental-engine.js`, `js/mental-games.js`, `js/mental-records.js`, `js/timer-session.js`, `css/mental-games.css`, `css/timer-session.css`, la migration ci-dessus, `tests/cognitive-menu.test.js`, `tests/mental-games.test.js`, `tests/mental-records-database.test.js`, `tests/timer-session.test.js`.

Fichiers modifiés : `tools.html`, `js/tools.js`, `js/tools-page.js`, `js/cognitive-games.js`, `js/cognitive-records.js`, `css/cognitive-games.css`, `scripts/check-build.mjs`, `README.md`, `supabase/README.md` et les tests existants `cognitive-games`, `boxing-compact-controls`, `tools-account-lifecycle`, `tools-advanced`, `tools-cognitive-integration`, `tools-controls-ui`, `tools-reaction-integration`, `tools-saves-integration`, `tools-wake-lock`, `tools` (tous `.test.js`). Ils suivent le nouveau parcours et vérifient la réinitialisation immédiate ainsi que la protection du mode verrouillé.

Validation locale : 746 tests réussis, contrôle des sources et compilation réussis. Essais Chromium à 320 × 568, 390 × 844, 568 × 320 et 1280 × 800; série complète de Double Tâche, record rechargé, saisie tactile et déverrouillage maintenu vérifiés. Aucun appel Supabase dans ces essais d’aperçu. Un appareil physique reste à essayer par l’utilisateur.

Améliorations à discuter après les essais : ajuster la difficulté et le barème selon l’usage; éventuellement conserver un historique des parties. Rien de cela ne sera ajouté automatiquement.

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

**Publication vérifiée — Mémoire visuelle, Double Tâche et mode séance (5 octobre 2026, Toronto)** : menu de cinq jeux dans Outils → Jeux cognitifs, Tuiles et Sac séparés, deux nouveaux jeux avec records privés, affichage plein écran et cadenas maintenu 3 s pour les timers conventionnels, réinitialisation sans confirmation sur tous les timers. Application `d727ad943e428ef947fc984233d6b03d91716cfa`, [workflow réussi](https://github.com/mixmasterkd/gestionboxeur/actions/runs/37409770321). Les 746 tests, contrôles et compilation réussissent localement et sur GitHub; les 42 fichiers servis sont identiques à l’artefact GitHub Pages (SHA-256 comparés). Les essais mobiles locaux couvrent les nouveaux jeux, le menu, la réinitialisation immédiate et le déverrouillage. La migration `cognitive_memory_dual_task` est appliquée sous la version distante `20261006033329`; les 196 lignes des 30 tables préexistantes sont conservées. Les sauvegardes et permissions ont été vérifiées sur le serveur par des écritures annulées en transaction; aucun compte ni résultat d’essai n’est conservé. Aucun nouvel avis de sécurité et aucune modification de `admin-users` version 4.

**Publication vérifiée — Test de réactivité (5 octobre 2026, Toronto)** : trois niveaux, séries de 1/5/10 coups, délai variable, résultats en millisecondes et records privés par mode et commande. Application `7ee1a5af17e853e5ca163d810102829d56243a88`, [workflow réussi](https://github.com/mixmasterkd/gestionboxeur/actions/runs/37318340647). Les 733 tests, contrôles et compilation réussissent; les 41 fichiers servis sont identiques à l’artefact GitHub Pages (SHA-256 comparés). Les essais locaux Chromium ont couvert ordinateur et portrait 320/390 px, toucher/clavier/souris, erreurs et records. Avant publication, les 25 migrations, RLS, politiques, droits et RPC des records ainsi que `admin-users` version 4 ont été revérifiés en lecture seule. Aucune nouvelle migration ni modification de données n’a été nécessaire pendant cette publication. La migration `reaction_personal_records` est déjà appliquée sous la version distante `20261005132435`; ne pas la rejouer sous sa version locale `20261005131442`.

**Publication vérifiée — Jeux cognitifs et timer (1er octobre 2026, Toronto)** : modes Tuiles/Sac, rubans masquables, records privés, installation intégrée à la connexion et au profil, pastilles sans texte et menu « Athlètes ». Le timer propose un sélecteur unique Infini/1–99, des unités min/sec, des lampes raccourcies et trois bascules vierges; les inscriptions de façade et le post-it sont plus lisibles. Logo, rotation, vis et fonctionnement sont conservés. Application `26d29c9ee63cf6f7b57ea05ad2d7f3cb4fad7262`, [workflow réussi](https://github.com/mixmasterkd/gestionboxeur/actions/runs/36949338597). 678 tests, contrôles et compilation réussis; essais Chromium sur ordinateur et en portrait 320/390 px. Les 40 fichiers servis correspondent exactement à l’artefact GitHub Pages. Connexion et aide d’installation contrôlées sur le site public à 390/1280 px, sans erreur JavaScript; l’aperçu de développement reste inaccessible en production sans compte. Les parcours connectés sont couverts par les tests isolés, sans nouvelle donnée d’athlète réelle. La migration `cognitive_personal_records` est appliquée au serveur sous la version `20261001232704`, après sauvegarde et comparaison des 146 lignes des 28 tables préexistantes, toutes conservées. Ne pas la rejouer sous sa version locale `20261001230552`.

**Version GBoxeur — 1er octobre 2026 (Toronto)** : installation mobile avec le logo existant, sans mode hors connexion, protection contre la veille des timers, timer classique 3D interactif, intervalles Base/Avancé, compteurs par round, sauvegardes privées et babillard. Vérifications locales : 617 tests, contrôle des sources et build; vues mobiles/ordinateur, installation Chromium et modes sombre/clair contrôlés dans un navigateur. Les résultats de publication sont disponibles dans les [exécutions GitHub Pages](https://github.com/mixmasterkd/gestionboxeur/actions/workflows/deploy-pages.yml). La migration `personal_tool_saves` est déjà appliquée au serveur sous la version `20261001203531`; ne pas la rejouer sous son horodatage local.

**Publication précédente — 30 septembre 2026 (Toronto)** : groupes, séances et notes communes, palette de couleurs, calendrier compact, clavier mobile et Outils. Application `6ce6b864ffab4b00dea961c6b6e52cb48e0cdd83`, [workflow réussi](https://github.com/mixmasterkd/gestionboxeur/actions/runs/36767802592). Les 471 tests, contrôles de sources et build ont réussi dans GitHub Actions. Les 26 fichiers servis correspondent exactement à l’artefact publié. Les trois nouvelles migrations sont appliquées et les données préexistantes sont conservées.

**Publication précédente — 23 septembre 2026 (Toronto)** : refonte Arena et correctif du compte athlète de test, commit `025b9e79636041458ab2cf3f0a7b8d9cbe34191c`, [workflow réussi](https://github.com/mixmasterkd/gestionboxeur/actions/runs/35953117413). La fonction `admin-users` est maintenant active en **version 4**, avec `verify_jwt=true`. Les 241 tests, les contrôles de sources et les contrôles de CSS compilé passent. Les six pages et douze fichiers CSS/JS publics correspondent exactement à l'artefact publié. Aucune migration supplémentaire, aucun compte créé et aucun courriel envoyé. Le [bilan d'audit](AUDIT.md) détaille les corrections et les limites de la validation visuelle et connectée. Les paragraphes suivants conservent l'historique de la première mise en production.

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


Les vues Tableau et Fiches sont disponibles sur téléphone et ordinateur, avec Tableau par défaut. Sur mobile, le tableau défile horizontalement et garde le nom visible. Les fiches regroupent nom et sélection, quatre renseignements côte à côte, puis statut et Modifier. Les deux vues conservent les mêmes filtres, sélections et tri. Le nom d’un athlète ayant partagé son calendrier ouvre directement ce calendrier; les autres noms ouvrent leur fiche. Rattacher se trouve uniquement dans la fiche, avec protection des modifications non enregistrées.


La préparation d’une liste s’ouvre sur Sparring, placé avant Combat. Le type de liste et les unités de poids partagent des boutons à état sélectionné explicite (contraste et coche), lisibles dans les deux thèmes. Les coachs contacts utilisent les surfaces et textes du thème actif.

L’administration affiche l’activation des fonctions coach, sans présenter Coach et Athlète comme des rôles exclusifs. Le motif neutre du fond suit les deux thèmes; les commandes principales ont une hauteur minimale de 44 px.

Les répétitions se créent comme des séquences libres : nombre en premier, type commun ou Hybride, puis lignes ajoutables, déplaçables et supprimables. Chaque ligne possède sa mesure (durée ou distance), une zone facultative et ses consignes. Le type commun évite de répéter le sport sur chaque ligne; Hybride expose les types individuels. Toute la séquence, récupération incluse si renseignée, est répétée dans l’ordre. Les anciens rounds, blocs imbriqués et champs avancés sont conservés. Les choix sont regroupés en Course, Boxe, Préparation physique et Autres, avec Jog, Corde à danser, Speed ball, Double end bag et Burpees.

L’éditeur affiche le type d’une étape; le nom personnalisé n’est proposé que pour Autre. Rounds et Répétition ouvrent le même éditeur de séquence avec une unité au choix (notation Texte : `3 rounds` suivi de lignes indentées). Les anciennes notations de rounds avec travail/repos restent lisibles. La zone reste propre à chaque ligne; Repos est un choix compact et les annotations de répétition sont réunies dans Notes. Titre, discipline, date et verrouillage forment un encadré en haut de séance. Un seul accès Bibliothèque propose séances et blocs, avec remplacement confirmé pour une séance et ajout pour un bloc.
