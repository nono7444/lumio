# Notes de version de Lumio

Chaque build publiée sur `main` devient une version `1.0.<n° de build>`.
Les nouveautés en préparation s'écrivent sous « À venir » : à la publication, la section est renommée
automatiquement avec le numéro de version et la date, et sert de notes dans l'appli, dans FlareStore et sur la Release GitHub.

## À venir

- Profil → Serveur : pourcentage d'avancement de Jellyfin pendant le remplacement des métadonnées par TMDB (et pendant un scan), bibliothèque par bibliothèque (serveur Lumio 3.26.0).

- Better Posters retiré (iPhone et Android) : toutes les affiches viennent de TMDB.
- Affiches et fonds toujours visibles : si Jellyfin n'a pas (ou plus) d'image pour un titre, l'affiche ou le fond TMDB s'affiche à la place, via le serveur Lumio (3.25.0), même sans identifiant TMDB (recherche par titre et année).

## 1.0.89 — 22 octobre 2026

- iPhone (admin) : Profil → Serveur → « Remplacer toutes les métadonnées par TMDB » (titres, résumés, affiches et fonds de tous les films et séries retéléchargés depuis TMDB).
- Serveur Lumio 3.24.0 : un film ou une série supprimé dans Jellyfin est retiré de Radarr / Sonarr (une saison supprimée seule n'est plus surveillée), et la fiche propose de nouveau « Demander ». La fiche recharge son statut à chaque retour dessus.

## 1.0.88 — 22 octobre 2026

- Série en partie sur le serveur : section « Saisons manquantes » sur sa fiche, avec un bouton « Demander » par saison (on demande une saison entière, jamais un épisode). Les épisodes « manquants » affichés par Jellyfin sont masqués.
- Épisodes plus rapides : requête allégée, saison suivante préchargée, saisons déjà ouvertes affichées tout de suite, vignettes immédiates (image de la série en attendant celle de l'épisode), longues saisons affichées par 30.

## 1.0.87 — 22 octobre 2026

- Fiche d'une série : chaque saison affiche son statut (Disponible, 6/10 épisodes, En téléchargement, Demandée, Pas disponible), avec le nombre de saisons disponibles et un bouton « Demander » à côté de chaque saison manquante.
- Serveur Lumio 3.22.1 : nombre d'épisodes présents par saison.
- Serveur Lumio 3.23.0 : affiches TMDB pour Lumio TV (/poster/movie|tv/{id}).

## 1.0.86 — 22 octobre 2026

- iPhone : l'onglet Lumio Secour est vraiment retiré de la barre d'onglets.

## 1.0.84 — 22 octobre 2026

- iPhone : la partie Addons Stremio et Lumio Secour (onglet et bouton « Liens ») est retirée.

- Serveur 3.22.0 : recherche TMDB pour Lumio TV (`/api/tmdb/search`, avec le statut sur le serveur) et relais TMDB (`/api/tmdb/proxy/…`) ; `/health` indique si la clé TMDB est configurée.

## 1.0.82 — 22 octobre 2026

- Nouvel onglet « Lumio Secour » (admin) : connexion au service, clé et compte AllDebrid, état des sources, et tous les réglages de Lumio Secour (sources, jeton TMDB, cache…) modifiables depuis l'appli.
- Fiche d'un film ou d'une série (admin) : nouveau bouton « Liens » qui affiche les liens trouvés par Lumio Secour (qualité, langue, taille, dispo AllDebrid) ; un appui télécharge le fichier sur le disque choisi.

## 1.0.80 — 22 octobre 2026

- Addons Stremio de catalogue réactivés (Profil → Addons Stremio) : leurs listes apparaissent en rangées sur l'accueil, les titres absents du serveur se demandent comme d'habitude. Les flux des addons ne sont pas utilisés.

- Admin, Profil → Serveur : scanner les bibliothèques, redémarrer Jellyfin, mettre à jour le serveur Lumio et redémarrer le PC serveur (avec confirmation).
- Serveur 3.19.0 : actions admin (`/api/admin/…`) ; script `server/lumio/host/install-host-actions.sh` à lancer une fois sur la machine pour le redémarrage et la mise à jour.

## 1.0.78 — 22 octobre 2026

- QR code de Lumio TV : scanner le QR affiché par la TV ouvre Lumio sur « Connecter la TV » (un appui suffit).
- Live TV : tes sources IPTV sont envoyées au serveur Lumio (sur ton compte) pour apparaître dans Lumio TV.
- Serveur 3.18.0 : page `/tvlink` (QR code de la TV), sources Live TV par compte (`/api/live/sources`), notes retrouvées aussi par identifiant IMDb (pastilles de Lumio TV).

- APK : bouton « Installer la dernière version » toujours présent dans Profil → Application.

## 1.0.76 — 21 octobre 2026

- Serveur 3.16.1 : lien d'installation `lumio.wawanono.lol/tvnuvio` pour Lumio TV (version Nuvio), `/tvnuvio64` pour la version 64 bits.

## 1.0.74 — 21 octobre 2026

- TV : lecteur fiabilisé — à la maison, la vidéo est lue directement sur l'adresse locale de Jellyfin (plus par le tunnel internet, qui provoquait les arrêts / reprises) ; réserve de lecture ramenée à une taille adaptée aux box TV.
- TV : fiches comme Nuvio — l'image de fond reste fixe en plein écran et la page défile par-dessus (plus rien de coupé en bas) ; casting en grands ronds, accessible à la télécommande.
- TV : affiches à la même taille que Nuvio.
- Serveur 3.16.0 : `/tv/setup` donne aussi l'adresse locale de Jellyfin (variable `LOCAL_JELLYFIN_URL`).

## 1.0.73 — 21 octobre 2026

- TV : sur la fiche d'un film ou d'une série de la bibliothèque, l'image de fond vient de TMDB (nette, sans texte) au lieu de celle de Jellyfin qui était zoomée et pixelisée ; la rangée « Dans le même genre » est retirée (elle était coupée en bas).

## 1.0.72 — 21 octobre 2026

- TV : fiches film / série comme Nuvio — logo, bouton ovale « Regarder » (ou « Demander » si le titre n'est pas dispo), boutons ronds Vu, Note et J'aime, puis réalisateur, résumé, genres, date, note et durée.
- TV : le lecteur ne se referme plus tout seul au premier appui sur « Regarder ».
- TV : l'onglet Téléchargements des Demandes ne devient plus noir (et plus aucun « tirer pour actualiser » sur TV).
- TV : Profil épuré — sans serveur Lumio, demandes, idées & signalements, clé TMDB, affiches et addons.

## 1.0.71 — 21 octobre 2026

- TV : accueil sur fond uni (plus d'image de fond) avec un bandeau d'infos compact du titre sélectionné ; les rangées remontent et on passe directement d'une rangée d'affiches à l'autre.
- TV : affiches instantanées (affiches du serveur sans service externe, sans fondu, gardées en cache) et sélection plus vive.
- TV : sons de navigation retirés.
- TV : page Demandes refaite (liste simple sur deux colonnes, avec le compte connecté et la raison si elle est vide).
- TV : lecteur plus fluide — vidéo affichée sans réduction de l'interface (rendu direct) et réserve d'avance plus grande contre les saccades.

## 1.0.70 — 21 octobre 2026

- Corriger les infos : après « Identifier », l'affiche et le fond sont téléchargés directement (la couverture ne reste plus noire). Nouveau bouton « Récupérer l'affiche et le fond » dans « Modifier » pour les titres déjà corrigés.

## 1.0.69 — 21 octobre 2026

- Admin : bouton « Corriger les infos » sur la fiche d'un film ou d'une série de la bibliothèque. « Identifier » cherche la bonne fiche (titre, année, ou lien TMDB / IMDb collé) et remplace titre, résumé et affiche. « Modifier » change titre, année et résumé à la main (verrouillés pour ne pas être écrasés), avec un bouton pour tout actualiser depuis Internet.

## 1.0.68 — 21 octobre 2026

- TV : les affiches ne sont plus coupées quand elles s'agrandissent (marge autour des rangées).
- TV : appli plus fluide — sélection sans ombre (seul l'agrandissement reste), images moins lourdes, et seul le fond de l'accueil se redessine quand on change d'affiche.
- TV : Demandes vide corrigé — si l'adresse du serveur Lumio manquait (connexion par code), l'appli prend celle de la maison automatiquement.

- Notes : retour des étoiles (1 à 10) ; sur les affiches, la note de la famille s'affiche en haut avec un verdict « Top », « Moyen » ou « Bouse ».
- Fiches : l'affiche entière en haut, sans le titre blanc rajouté par-dessus.
- Admin, sur la fiche d'un titre : « Voir dans le disque » (ouvre la gestion des disques sur son dossier) et « Supprimer » (titre et fichiers).
- Disques : recherche par nom dans un disque ou dans tous ; sélection de plusieurs éléments pour les déplacer ou les supprimer d'un coup (appui long pour commencer).
- Bibliothèque : cartes avec une grande image du dernier ajout ; appui long pour choisir l'image.
- Recherche : menu « Thèmes » (Noël, Halloween, Saint-Valentin, Action, Comédie, Horreur…) qui montre les films ou séries les mieux notés du thème.
- Connexion : l'adresse du serveur est trouvée toute seule, il suffit d'entrer son identifiant et son mot de passe.
- Message épinglé et mise à jour disponible : ils reviennent à chaque ouverture de Lumio tant qu'ils sont d'actualité.
- Notifications sur iPhone : le nom du sujet ntfy est copié avec les étapes pour s'abonner (l'appli ntfy ne s'ouvre pas depuis un lien sur iPhone).
- Demandes : le dossier Films est proposé en premier (Kids en dernier) ; pour les séries, Séries puis Animés.
- Lien d'invitation : tutoriel FlareStore pour iPhone et étapes pour Android.
- Comptes de la famille : dans Profil, juste « Serveur en ligne » avec un point vert.
- Serveur Lumio 3.15.0 requis.

## 1.0.66 — 21 octobre 2026

- Android : corrigé le plantage à l'ouverture (module Chromecast) ; chaque APK est désormais testé sur un téléphone virtuel avant d'être publié.

## 1.0.65 — 21 octobre 2026

- Android : bibliothèques natives extraites à l'installation (démarrage plus fiable sur certains téléphones).

## 1.0.64 — 20 octobre 2026

- TV : nouvelle interface inspirée de Nuvio — menu latéral à gauche qui se déploie quand on y entre, accueil avec le titre sélectionné en grand fond (logo, infos, résumé) et les rangées dessous, fiches avec image en fond et infos alignées à gauche.
- TV : effet de sélection plus fin et animé en douceur, plus de couleur orange sur l'onglet actif.
- Démarrage plus rapide (animation raccourcie, quasi instantanée sur TV).

## 1.0.63 — 20 octobre 2026

- TV : réglage « Taille de l'interface » (Très petite à Grande) dans Profil → Télévision ; par défaut tout est plus petit.
- TV : barre du haut flottante effet verre, posée sur l'image de l'accueil (plus de bandeau noir dessous).
- TV : sélection à la télécommande façon Apple TV (l'élément grandit, plus de contour blanc) et sons de navigation (désactivables).
- TV : fiches plus compactes (image moins haute, boutons Lire / Vu moins larges), bibliothèque sur 3 colonnes, Demandes affiche tout d'emblée.

## 1.0.57 — 20 octobre 2026

- Notes en chips 🥔 : 10 petites chips à toucher sur une ligne, encadré plus compact ; sur les affiches, la note de la famille est centrée en bas avec une chips.
- Nouvelle animation de démarrage façon Google : quatre points rebondissent puis deviennent le logo (sans texte).
- Demande de saisons : grille compacte, toutes les saisons visibles sans défiler.
- Demandes de séries : saisons repliées sur une ligne, − / + pour les afficher.
- Widget iOS sur l'écran verrouillé (en ligne, rond et rectangle).
- Pastille sur l'icône de Lumio (messages non lus, et pour l'admin demandes à valider + signalements) ; notification d'un nouveau message même appli fermée (iPhone et Android, au rythme permis par le système).
- Profil → Notifications : s'abonner dans ntfy pour être prévenu des messages, des demandes et des titres disponibles ; l'admin reçoit aussi les téléchargements lancés / importés.
- Profil (admin) → Message sur l'accueil : un message épinglé qui s'ouvre en pop-up chez toute la famille, masqué une fois lu.
- Bibliothèque : de vraies collections (sagas) rangées par Lumio, à la place des collections Jellyfin.
- Accueil : le grand bandeau ne montre plus que les nouveaux films, séries et programmes enfants (sans les animés).
- Statistiques machine : débit internet en direct (↓ / ↑).
- TV : tout est plus petit (affiches, bandeau), le bandeau ne déborde plus de l'écran, contour de sélection plus fin ; lecture avec le lecteur Android natif (l'image s'affiche de nouveau).
- Serveur Lumio 3.14.0 requis.
- Android : compilation réparée (nouvelle version du module Chromecast de Google incompatible, version précédente figée).

## 1.0.55 — 19 octobre 2026

- Séries ouvertes depuis la recherche : la fiche affiche les saisons et les épisodes, pour lancer celui qu'on veut (comme dans la Bibliothèque).

- Séries : la fiche affiche les saisons et la liste des épisodes, pour lancer celui qu'on veut.

- Bouton Bande-annonce retiré des fiches.
- Séries partielles : le compte se fait sur toutes les saisons de la série (« 1 saison sur 10 »).

## 1.0.52 — 19 octobre 2026

- Séries : quand seule une partie des saisons a été trouvée, la demande passe en « Partiel · 1 saison sur 10 » au lieu de rester en recherche (avec le bouton « Relancer la recherche »).
- Fiches : boutons Lire et Bande-annonce plus petits, côte à côte ; le bouton Jellyfin est retiré.
- Bandes-annonces : d'abord celles de l'iTunes Store France (vidéo directe d'Apple, en français), lues dans le lecteur de Lumio ; YouTube seulement en secours.
- Nouvelle animation de démarrage : une bulle tombe sur le logo, éclate, et le logo se remplit de lumière.
- Statistiques : le bouton « − » réduit d'un coup chaque carte à une seule ligne fine.
- Serveur Lumio 3.12.0 requis pour le statut « Partiel ».

## 1.0.49 — 18 octobre 2026

- Notes : les tomates laissent place à des puces de 1 à 10 sur une seule ligne, colorées selon la note. « Notes de la famille » s'appelle maintenant « Notes ».
- Bande-annonce lue directement dans le lecteur mpv de Lumio (jusqu'en 1080p, piste française si elle existe).
- Statistiques serveur et statistiques de visionnage : boutons − / + sur chaque carte pour la réduire ou l'agrandir (graphiques plus grands, plus de lignes, historique de chaleur).
- Widget iOS refait façon UptimeRobot (barres des 24 dernières heures, % de disponibilité, processeur et chaleur), nouveau grand format, rafraîchi toutes les 5 min, à chaque ouverture de Lumio, et avec un bouton ↻ (iOS 17).
- Corrigé : l'erreur « fetch failed: UnexpectedException: cancelled » (requête coupée par iOS) — la requête est relancée toute seule.
- Grande image d'accueil en pleine définition.
- Téléchargements : pourcentage en direct (toutes les secondes pour AllDebrid, avec le temps restant ; quelques secondes pour Radarr / Sonarr).
- Demandes dont la recherche est en attente : bouton « Relancer la recherche » qui dit si une version a été trouvée ou si c'est toujours indisponible.
- Imports Radarr / Sonarr plus rapides : le serveur Lumio déclenche l'import dès qu'un téléchargement est fini et fait rescanner Jellyfin juste après.
- Serveur Lumio 3.11.0 requis.

## 1.0.48 — 18 octobre 2026

- Notes de la famille en tomates 🍅 sur 10 (les anciennes notes sont converties). Sur les affiches : la note de la famille si le titre est noté, sinon la note Better Posters.
- Commentaire sur une note : marche maintenant aussi sur Android et la TV.
- Bande-annonce (en français si elle existe) sous le bouton Lire.
- Fiches : plus de « date numérique pas encore annoncée » pour les films déjà sortis.
- Disques : le déplacement vers un autre disque affiche sa progression en %.
- Admin : statistiques de visionnage dans « En cours de lecture » (temps par compte, activité sur 30 jours, top films, top séries).
- Admin : supervision façon UptimeRobot (historique 24 h de chaque service) et la machine en direct : processeur, température, mémoire, disques.
- Les notifications s'affichent en bas, juste au-dessus de la barre.
- Accueil : plus de bandeau noir en faisant défiler.
- VPN : lancement des raccourcis plus fiable et explications refaites (avec l'automatisation « à l'ouverture de Lumio »).
- TV : images en haute définition, contour de sélection qui ne décale plus les affiches, barre du haut plus fine et translucide avec seulement Accueil, Bibliothèque, Recherche et Demandes, accueil épuré.
- Serveur Lumio 3.10.0 requis.

- Clé TMDB partagée : celle de l'admin est confiée au serveur Lumio et les autres comptes (famille, TV) la reçoivent automatiquement, plus rien à saisir (serveur Lumio 3.9.2).

## 1.0.46 — 18 octobre 2026

- Nouvelle appli Android TV : le même Lumio que sur l'iPhone (mêmes écrans, mêmes fonctions, même design), adapté à la télécommande : barre d'onglets en haut, éléments sélectionnés bien visibles, tailles adaptées à la TV. Elle remplace l'ancienne Lumio TV (NuvioTV).
- TV : connexion sans clavier. La TV affiche un code, on le valide sur le téléphone (Profil → Connecter une TV).
- Serveur Lumio 3.9.1 : lumio.wawanono.lol/tv donne la nouvelle appli TV.

## 1.0.45 — 18 octobre 2026

- Fiche d'un film ou d'une série pas encore sortie : « Disponible en numérique le … » (ou date de sortie au cinéma, nouvelle saison, prochain épisode).
- Admin : icône ⚠️ toujours visible en haut de l'accueil pour ouvrir les signalements (avec le nombre de nouveaux).
- Admin : nouvelle icône Téléchargements sur l'accueil : colle un lien d'hébergeur ou un magnet, AllDebrid le récupère et le serveur le télécharge directement sur le disque et le dossier choisis (progression en direct, Jellyfin rafraîchi à la fin).
- Admin : gestion des disques du serveur : place libre, parcourir les dossiers, créer un dossier, renommer, déplacer (même vers un autre disque), supprimer.
- Serveur Lumio 3.9.0 requis (et les disques à monter dans le conteneur).

## 1.0.44 — 18 octobre 2026

- Profil → « Connecter une TV » : tape le code affiché par Lumio TV pour la connecter à ton compte, sans rien saisir à la télécommande.
- Serveur Lumio 3.8.0 : donne aux TV l'adresse de Jellyfin pour leur configuration automatique.

## 1.0.43 — 18 octobre 2026

- Serveur Lumio 3.7.2 : lumio.wawanono.lol/tv donne maintenant la version légère de Lumio TV (≈ 50 Mo, compatible avec toutes les box) au lieu de l'APK de 130 Mo qui faisait planter Downloader ; /tv64 pour la version 64 bits.

## 1.0.39 — 17 octobre 2026

- Nouvelle appli Mac (Intel et Apple Silicon, macOS 12 et plus, Tahoe compris) : le même Lumio dans une fenêtre Mac, publié en .dmg à chaque version (lumio.wawanono.lol/mac).
- Mac : lecture Jellyfin dans le lecteur du Mac (lecture directe quand c'est possible, sinon conversion par le serveur), raccourcis clavier (espace, flèches, F pour le plein écran, Échap pour quitter).
- Mac : mise à jour proposée dans l'appli (téléchargement du nouveau .dmg).
- Serveur Lumio 3.7.1 : raccourci /mac vers la dernière version Mac.

## 1.0.38 — 17 octobre 2026

- Nouvelle barre du bas façon iOS 26 (« Liquid Glass ») : icône et nom sous chaque onglet, bulle sur l'onglet actif, mêmes couleurs.
- Barre du bas personnalisable : appui long sur la barre (ou Accueil → Personnaliser) pour ajouter, retirer et ranger les raccourcis.
- Calendrier et Chat quittent la barre du bas et passent en haut de l'accueil (petite vignette du jour pour le calendrier, point rouge pour les nouveaux messages). On peut les remettre dans la barre.
- Admin : icône ⚠️ en haut de l'accueil avec le nombre de problèmes signalés, qui ouvre directement la liste.
- Notes de la famille visibles sur les affiches (★ 4,5).
- Fiche : notes de la famille et « Signaler un problème » (avec icône ⚠️) remontés juste sous les boutons Lire / Vu.
- Live TV : bouton VPN pour démarrer ou éteindre Proton VPN (via l'app Raccourcis), avec démarrage automatique en option.
- Calendrier : les plateformes ne sont plus coupées de moitié.
- Correction : la pastille rouge du Chat disparaît bien une fois les messages lus.
- Serveur Lumio 3.7.0 conseillé (notes sur toutes les affiches ; sinon seulement les coups de cœur).

## 1.0.36 — 17 octobre 2026

- Notes de la famille et « Signaler un problème » aussi sur les fiches ouvertes depuis la Bibliothèque et l'Accueil (titres Jellyfin).

## 1.0.35 — 17 octobre 2026

- Profil : la configuration de Radarr et Sonarr disparaît pour de bon (tout est réglé sur le serveur Lumio).

- Calendrier : la bande des jours est retirée, il ne reste que les plateformes et la liste des sorties.

## 1.0.33 — 17 octobre 2026

- Notes de la famille : chacun note un film ou une série en étoiles (avec un petit avis) sur sa fiche ; moyenne et avis des autres visibles, rangée « ⭐ Coups de cœur de la famille » sur l'accueil.
- Signaler un problème sur un film ou une série (vidéo, son, sous-titres, mauvais titre…) depuis sa fiche : l'admin est prévenu et le retrouve dans « Idées & signalements ».
- Calendrier organisé par plateforme (Netflix, Prime Video, Disney+, Canal+…, logos et nombre de sorties), plus « Achat / location ».
- Seerr retiré : les demandes passent uniquement par le serveur Lumio.
- Correction : l'onglet Demandes n'affiche plus « Connecte Radarr et Sonarr » quand le serveur Lumio est momentanément injoignable ; il réessaie tout seul.
- Serveur Lumio 3.6.0 requis pour les notes et les signalements.

## 1.0.32 — 17 octobre 2026

- Logo animé au lancement de l'appli.

## 1.0.30 — 17 octobre 2026

- Demandes : profil de qualité imposé « HD-1080p nono » pour les films et les séries (serveur Lumio 3.5.0, réglable par l'admin).
- Lecteur : statistiques en direct (méthode de lecture directe ou conversion, codecs, résolution, débit, décodage matériel, réseau, tampon).
- Lecteur : image dans l'image depuis mpv (bascule sur le lecteur natif), et bouton « remplir l'écran » dans le lecteur natif.
- Accueil : « 🍿 Prochaine soirée cinéma », des films pas encore vus choisis d'après tes genres préférés, calculés sur le téléphone et renouvelés chaque jour.

## 1.0.29 — 16 octobre 2026

- Nouvelle appli Android (téléphone) : APK publié à chaque version (lumio.wawanono.lol/android), mise à jour proposée dans l'appli.
- « Inviter quelqu'un » partage maintenant une page web cliquable partout, qui explique l'installation (Android ou iPhone) et configure l'appli.
- Serveur Lumio 3.5.0 : raccourci /android et page /invite.

## 1.0.28 — 16 octobre 2026

- Live TV : tri par langue (🇫🇷 Français par défaut, ou un autre pays) et par thème (Sport, Info, Cinéma & séries, Enfants, Documentaires, Musique, Généralistes), puis par groupe.
- Live TV : les comptes Xtream Codes ne chargent plus que les chaînes en direct (plus les films et séries à la demande), avec leurs vraies catégories.

## 1.0.27 — 16 octobre 2026

- Live TV : les listes IPTV et chaînes en « http:// » (Xtream Codes, M3U) se chargent enfin (blocage de sécurité iOS levé).

## 1.0.26 — 16 octobre 2026

- Live TV : quand une chaîne d'un addon Stremio a plusieurs sources, le lecteur passe automatiquement à la suivante si l'une ne marche pas.
- Live TV : le lecteur se présente comme VLC auprès des serveurs IPTV (certains refusent les autres lecteurs).

## 1.0.24 — 16 octobre 2026

- Nouvel onglet Live TV : ajoute ta liste IPTV (lien M3U ou compte Xtream Codes) ou un addon Stremio de chaînes ; groupes, recherche et favoris (appui long).
- Admin : « En cours de lecture » dans Profil, pour voir qui regarde quoi, où il en est, sur quel appareil, et si le serveur convertit la vidéo.

## 1.0.23 — 16 octobre 2026

- Fiche d'un film : le bouton Demander devient une barre de téléchargement en direct (pourcentage), puis « Lire » dès que le film est dans Jellyfin.
- Un film ou une série déjà dans Jellyfin est reconnu partout (même ajouté sans Radarr / Sonarr) : plus de bouton Demander, plus de second téléchargement.
- Reconnaissance des titres Jellyfin par identifiant TMDB / IMDb, même quand le titre diffère (VO / VF).
- Serveur Lumio 3.4.0 : vérifie aussi le contenu de Jellyfin avant d'accepter une demande.

## 1.0.20 — 16 octobre 2026

- Lecteur : choix de la qualité (Original, 4K, 1080p, 720p, 480p, avec le débit) et qualité par défaut dans Profil → Lecture.
- Bibliothèque refaite : uniquement tes bibliothèques Jellyfin, en grandes cartes avec les dernières affiches et le nombre de titres.
- Bibliothèques triées par date de sortie, du plus récent au plus ancien.
- Accueil : les derniers ajouts ne montrent que les sorties de l'année (et suivantes), nouvelles saisons comprises.
- Calendrier : dates exactes des sorties numériques (VOD) des films et des nouvelles saisons sur les plateformes. Plus de sorties cinéma.
- Fiche : plus de bouton Demander / Proposer pour un titre déjà disponible ; « Proposer à la famille » devient « Proposer ».
- Chat réservé à la discussion : les annonces de demandes n'y apparaissent plus.
- Notifications push pour l'admin (via ntfy) avec boutons Valider / Refuser.
- Widget iOS « Serveurs Lumio » : Jellyfin, Radarr, Sonarr et serveur Lumio en ligne ou non.
- Version de l'appli dans Profil et alerte quand une nouvelle version est disponible.
- Mode développeur : la famille propose des idées ou signale des bugs, l'admin les envoie à Claude.
- Addons Stremio désactivés pour l'instant.
- Serveur Lumio 3.3.0 requis pour les notifications, le widget, les idées et l'alerte de version.

## 1.0.19 — 16 octobre 2026

- Demandes : suivi en direct dans Radarr / Sonarr (recherche, téléchargement en %, import).
- Une demande bloquée apparaît « À vérifier » avec le message de Radarr / Sonarr, au lieu de rester « Approuvée ».
- La disponibilité des demandes est vérifiée toutes les 2 minutes.

## 1.0.18 — 15 octobre 2026

- L'appli Android TV devient Lumio TV, basée sur NuvioTV, dans son propre dépôt (nono7444/lumio-tv).

## 1.0.17 — 15 octobre 2026

- Serveur 3.1 : demandes et statut à partir de l'identifiant IMDb (pour l'appli TV).
- Raccourci `lumio.wawanono.lol/tv` vers le dernier APK de Lumio TV.

## 1.0.16 — 15 octobre 2026

- Serveur : premier raccourci `/tv` pour installer l'appli Android TV.

## 1.0.15 — 15 octobre 2026

- Radarr et Sonarr se règlent uniquement sur le serveur Lumio : les rubriques sont masquées dans Profil et les clés effacées du téléphone.

## 1.0.14 — 15 octobre 2026

- Demandes comme dans Seerr via le serveur Lumio : statuts, choix des saisons, validation automatique ou par l'admin, quotas, gestion des utilisateurs.
- Fin du streaming : la lecture se fait uniquement depuis Jellyfin.

## 1.0.13 — 15 octobre 2026

- Première appli Android TV (APK), utilisable à la télécommande.
- Personnalisation de la Bibliothèque.
- Streaming via AllDebrid et addons Stremio (retiré dans la 1.0.14).

## 1.0.9 — 15 octobre 2026

- Serveur Lumio : téléchargements pour toute la famille sans Seerr, les clés Radarr / Sonarr restent sur le serveur.
- Choix du dossier (Films, Kids, Anime…) à chaque ajout.
- État des serveurs (Jellyfin, Radarr, Sonarr) dans Profil.
- Chromecast dans le lecteur.
- Barre d'onglets plus lisible.

## 1.0.8 — 15 octobre 2026

- Mises à jour automatiques via la source FlareStore / AltStore.
- Réglages conservés (trousseau iOS + Jellyfin).
- Calendrier des sorties, accueil Jellyfin avec sélections et thèmes de saison.
- Chat de la famille (serveur Lumio).

## 1.0.6 — 15 octobre 2026

- Lecture unifiée Jellyfin, épisode suivant automatique.
- Demandes pour les comptes non admins, lien d'invitation.
- Bibliothèques Jellyfin complètes, personnalisation de l'accueil et des onglets.

## 1.0.5 — 15 octobre 2026

- Première version : connexion Jellyfin, bibliothèque et lecture.
- Lecteur mpv qui lit tout (MKV inclus), pistes audio et sous-titres, piste française automatique.
- Recherche TMDB, ajout direct dans Radarr / Sonarr.
- Design inspiré de Nuvio : barre d'onglets flottante, grand carrousel, logos et casting.
