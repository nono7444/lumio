# Notes de version de Lumio

Chaque build publiée sur `main` devient une version `1.0.<n° de build>`.
Les nouveautés en préparation s'écrivent sous « À venir » : à la publication, la section est renommée
automatiquement avec le numéro de version et la date, et sert de notes dans l'appli, dans FlareStore et sur la Release GitHub.

## À venir

- Menu des univers réorganisé : Films & séries, Lumio Auto, Livres, Livres audio, puis TV (la Live TV devient un univers à part).
- Twitch n'est plus un univers : un onglet Twitch dans Lumio Auto sert à sauvegarder les rediffusions sur le serveur (toucher une rediffusion → choisir la qualité). Les lives sont retirés.

## 1.0.222 — 27 novembre 2026

- Live TV : l'IPTV peut passer par le serveur Lumio et son VPN (comme qBittorrent). Identifiants gardés sur le serveur, une seule connexion par chaîne partagée entre vous, limite de chaînes en même temps réglable. Visible sur le téléphone et sur Lumio TV (serveur 3.159.0).

## 1.0.221 — 27 novembre 2026

- Twitch : onglet « En direct » — tes chaînes en live, les lives en français et les lives par jeu (jeux les plus regardés) ; un appui lance le live. Sans pub par défaut (relais Luminous / Perfprod, repli automatique sur le flux officiel, bouton « Sans pub / Avec pub »), qualités jusqu'au 1440p avec ton compte Twitch connecté. Le bandeau « EN DIRECT » d'une chaîne lance aussi le live (serveur 3.158.0).

## 1.0.220 — 26 novembre 2026

- Livres (admin) : bouton « Télécharger les tomes manquants (N) » sur une collection : le serveur cherche chaque tome absent (C411, Tr4ker, Wawacity, recherche ciblée par tome) et lance les téléchargements tout seul ; les cases passent « EN COURS », et les tomes introuvables sont notés dans le journal de « Séries à compléter » (serveur 3.157.0).

- Serveur, Livres : un tome en double (même nom) dans un dossier de téléchargement → la version la plus complète est gardée dans le dossier de la série, l'autre retirée ; un fichier encore en cours d'écriture n'est jamais déplacé (serveur 3.156.0).

- Serveur, Livres : un tome déjà rangé (même nom, même taille) laissé en double dans un dossier de téléchargement est retiré, pour que le dossier puisse être supprimé ; rangement vérifié toutes les 2 min au lieu de 10 (serveur 3.155.0).

- Serveur, Livres : rangement complet du dossier. Les dossiers de téléchargement (« One Piece (01-100+3HS) (Oda) [Digital] (PRiNTER) », « Bleach.74.Tomes… », « One Piece T111 - FR - Ebook Officiel », « Kaamelott, Tomes 01 à 10 [BD]… ») sont vidés dans le dossier de leur série (« One Piece/ », « Bleach/ », « Kaamelott/ ») puis supprimés s'il n'y reste que des .nfo / images de présentation ; un dossier au nom proche est réutilisé (« Tsugai - Daemons of the Shadow Realm » pour « Daemons of the Shadow Realm ») et tous ses tomes forment une seule collection ; dans Disques, les dossiers de livres montrent la couverture du premier tome au lieu d'une affiche de film (serveur 3.154.0).

- Serveur : les tomes posés en vrac dans le dossier Livres (« One Piece T103.cbz », « Naruto.T71… ») sont rangés tout seuls dans le dossier de leur série, créé s'il n'existe pas (un dossier existant au nom proche est réutilisé) ; lecture en cours et couverture gardées (serveur 3.152.0).

- Livres : les fichiers nommés « V001 », « v12 »… (scans) sont reconnus comme tome 1, tome 12 : les collections ne montrent plus tous les tomes en « pas sur le serveur », et chaque tome retrouve sa propre couverture (serveur 3.151.0).

## 1.0.219 — 26 novembre 2026

- Livres (admin) : appui long sur une collection (ou un tome seul) dans Biblio → « Ranger dans BD » / « Ranger dans Mangas » ; le choix est gardé par le serveur et vaut pour tous les tomes de la série (serveur 3.150.0).

## 1.0.218 — 26 novembre 2026

- Livres réorganisé en trois onglets bien séparés : Biblio (Mangas ou BD, un seul type à la fois, plus de romans), Trouver (mangas et BD) et Top (nouveaux mangas 2026+, derniers mangas parus en France, top BD Apple Books). Les tendances ne sont plus mélangées à la bibliothèque (serveur 3.149.0).

## 1.0.217 — 26 novembre 2026

- Livres : choix en haut de la bibliothèque entre Livres, Mangas et BD (séparés : d'après le dossier, sinon la série cherchée sur MangaDex ; l'admin peut ranger une série à la main depuis sa page).
- Livres : rangées « Mangas du moment » (AniList) et « Top livres » (classement Apple Books France) ; Livres audio : « Top livres audio ». L'admin touche une couverture → la recherche du titre se lance (serveur 3.148.0).

- Lumio Auto : « Relancer la recherche » remet les saisons de la demande dans le suivi (en entier) ; une série demandée sans saison précise prend toutes les saisons ; les vieux épisodes sans date sur TMDB comptent comme diffusés (serveur 3.147.0).

- Lumio Auto : une série déjà suivie depuis la bibliothèque puis demandée (ex. Wakfu) restait sur « rien ne manque » car seuls les nouveaux épisodes étaient attendus ; les saisons demandées se téléchargent maintenant en entier, et la note affiche « téléchargement en cours » quand c'est le cas (serveur 3.146.0).

- Livres : C411 revient. Pour C411 et Tr4ker, le serveur essaie l'adresse et la clé de Lumio Auto, puis l'adresse officielle avec la clé des livres, et garde la première qui répond (serveur 3.145.0).

## 1.0.216 — 25 novembre 2026

- Livres : les collections affichent tous les tomes parus (liste et couvertures de MangaDex), même ceux que tu n'as pas, marqués « PAS SUR LE SERVEUR ». Un appui sur l'un d'eux lance directement la recherche de ce tome (C411, Tr4ker, Wawacity) avec téléchargement en un appui et suivi en direct (« EN COURS 42 % » dans la collection).
- Livres (admin) : nouvel écran « Téléchargements » (bouton nuage en haut de l'onglet Livres, avec le nombre en cours) : étape, progression, vitesse, temps restant, annuler, retirer les terminés (serveur 3.144.0).

## 1.0.215 — 25 novembre 2026

- Livres : les tomes manquants s'affichent dans chaque collection (case « MANQUANT », ou « EN COURS » pendant le téléchargement). Séries à compléter : cherche aussi les 12 tomes suivants avec une recherche ciblée (« One Piece T101 »), 12 téléchargements au plus par passage (serveur 3.143.0).

## 1.0.214 — 25 novembre 2026

- Livres (admin) : « Séries à compléter » (bouton ✦ en haut de l'onglet Livres). Le serveur repère les tomes manquants de chaque série et le tome suivant, les cherche toutes les 6 h sur C411, Tr4ker et Wawacity, et les télécharge tout seul (en français, même format, 6 au plus par passage). Liste des trous et journal dans l'écran (serveur 3.142.0).

## 1.0.213 — 25 novembre 2026

- Serveur : nouvelle carte « Livres : C411 et Tr4ker » pour enregistrer les clés de recherche des livres, BD et livres audio (gardées sur le serveur) (serveur 3.141.0).

- Livres, BD et livres audio : Tr4ker trouve enfin des résultats (même adresse que dans Lumio Auto, et recherche élargie quand le site range ses livres dans d'autres catégories) (serveur 3.140.0).

- Livres et BD : boutons « Recharger les infos » retirés (fiche et série) ; « Changer la couverture » reste.

## 1.0.211 — 25 novembre 2026

- Livres et BD (admin) : « Recharger les infos » sur un livre et sur toute une série (refait le titre et la recherche de couverture), et « Changer la couverture » : propositions en français, lien d'une image collé, ou image du téléphone. Appui long sur un tome dans une série pour y aller directement (serveur 3.139.0).

## 1.0.210 — 25 novembre 2026

- Livres et BD : l'édition française officielle passe avant la 1re page du fichier (parfois la couverture japonaise), et le téléphone récupère une couverture dès qu'elle change sur le serveur (serveur 3.138.0).
- qBit : la carte avec les interrupteurs Lumio Auto / AllDebrid n'est plus en haut de l'onglet (le serveur gère tout) ; ils restent dans Serveur → Sites et réglages. Un rappel s'affiche seulement si Lumio Auto est en pause.

## 1.0.209 — 25 novembre 2026

- Disques : les dossiers et fichiers de films et séries affichent leur jaquette, dans la liste comme dans la recherche (serveur 3.136.0).
- Séries en cours de diffusion : les prochains épisodes s'affichent grisés avec leur date de sortie (« Sortie le mar. 2 déc. »), y compris la saison qui démarre.
- Accueil : plus de démarcation entre la grande image et le reflet en dessous ; le bas de la photo se fond doucement dans le reflet (même flou, même teinte de saison).
- Livres et BD : couvertures en français d'abord (la 1re page du fichier si elle est en couleur, puis l'édition française en ligne avec le bon numéro de tome, MangaDex en dernier). Les couvertures sont préparées à l'avance sur le serveur et gardées sur le téléphone : elles s'affichent tout de suite (serveur 3.137.0).
- Bibliothèque : l'onglet s'affiche immédiatement avec la dernière liste connue, puis se met à jour.

## 1.0.208 — 24 novembre 2026

- Fiche d'un film ou d'une série : « Lire » s'il est sur le serveur, « Télécharger » s'il est déjà sorti, sinon « Demander » avec sa date de sortie (cinéma ou numérique, d'après le calendrier puis TMDB).
- Plus aucun streaming dans Lumio : les titres absents se téléchargent ou se demandent.
- Fini l'écran « Arrivée dans Jellyfin » qui devenait « Lire » : le bouton « Lire » s'affiche directement.
- Lumio Auto est maintenant dans Lumio : nouvel univers « Lumio Auto » (admin) avec Perf, Seed, Demandes, qBittorrent, Disques, Serveur et Lecture ; l'appli Lumio Auto séparée disparaît.
- Onglets Chat et Demandes retirés de Films & séries (les demandes se gèrent dans l'univers Lumio Auto).
- Accueil : la barre du haut reste en place et prend un fond flouté quand on fait défiler.
- Accueil : un reflet prolonge les couleurs de l'image du haut au lieu d'un passage brutal au noir.
- Nouveau : Profil → Apparence, pour régler couleurs, fond, arrondis, boutons en verre, taille des affiches et reflet avec des curseurs (aperçu en direct).
- Serveur 3.135.0 : date de sortie de chaque titre (/api/release).

## 1.0.207 — 22 novembre 2026

- Twitch : les téléchargements ne restent plus bloqués à 100 % (le fichier n'est plus réécrit en entier à la fin) ; « finalisation » ou « rien de neuf depuis X min » s'affiche si besoin.
- Serveur 3.133.0 : un téléchargement Twitch qui ne bouge plus pendant 15 min s'arrête avec un message clair.

## 1.0.206 — 22 novembre 2026

- Twitch : à la maison, « Mes rediffusions » se lisent directement sur le serveur, sans passer par le tunnel Cloudflare (beaucoup moins de processeur).
- « Qui utilise le processeur ? » : relevé plus rapide, sans solliciter la machine.
- Serveur 3.132.0 : adresse locale du serveur communiquée à l'appli (LOCAL_LUMIO_URL, facultatif).

## 1.0.205 — 22 novembre 2026

- « Qui utilise le processeur ? » affiche maintenant un résultat tout de suite (total, part de Lumio) et dit clairement ce qui manque.
- Serveur 3.131.0 : relevé immédiat du processeur.

## 1.0.204 — 22 novembre 2026

- Profil → Serveur : bouton « Qui utilise le processeur ? » qui montre les conteneurs et programmes les plus gourmands, sans SSH.
- Serveur 3.130.0 : lecture des rediffusions et vidéos du serveur plus légère pour le processeur.

## 1.0.203 — 22 novembre 2026

- Twitch : nouvel onglet « Mes rediffusions » avec les rediffusions téléchargées sur le serveur (lecture, reprise, suppression par appui long).
- Twitch : bouton « Disque » pour choisir le disque où sont rangées les rediffusions (déplace aussi celles déjà téléchargées).
- Serveur 3.129.0 : liste et suppression des rediffusions téléchargées, miniatures conservées.

## 1.0.202 — 21 novembre 2026

- Twitch : choix de la qualité comme sur Twitch (Auto, Source, 1080p60, 720p60, 480p… Audio seul), gardée pour les prochaines lectures ; appui long sur une rediffusion pour la regarder dans une autre qualité.
- Twitch : « Télécharger sur le serveur » (appui long) enregistre une rediffusion sur un disque, dans la qualité choisie, avec le pourcentage en direct ; le dossier « Twitch » peut être déplacé sur un autre disque. Notification quand c'est fini.

## 1.0.201 — 21 novembre 2026

- Twitch : « Se connecter » avec ton compte Twitch abonné (page de connexion officielle de Twitch dans l'appli, ou jeton collé) pour lire les rediffusions réservées aux abonnés. Le jeton reste seulement sur ton serveur.

- Lumio (admin) : nouvel univers **Twitch** dans le menu en haut de l'accueil. Les rediffusions des chaînes suivies (Altair par défaut, + pour en ajouter, appui long pour retirer), le direct en cours, « Reprendre », et un tri par jeu : choisir un jeu montre les rediffusions où il a été joué et la lecture démarre au début de ce jeu. Les chapitres de chaque rediffusion permettent de sauter d'un jeu à l'autre. La position est gardée sur le serveur.

## 1.0.199 — 21 novembre 2026

- Lumio Auto, Seed : un torrent « partage seul » en file d'attente dans qBittorrent démarre tout de suite (démarrage forcé) au lieu de rester à 0 %, et la liste dit pourquoi un torrent n'avance pas (en attente, aucune source, vitesse et sources).

## 1.0.198 — 20 novembre 2026

- Livres : les packs (.rar, .7z, .zip de plusieurs tomes), les BD en .cbr et les tomes livrés en dossiers de pages sont rangés tout seuls en CBZ lisibles. Pour l'admin, la bibliothèque liste les fichiers que la liseuse ne sait pas ouvrir.
- Profil (admin) : le déplacement des livres et livres audio vers un autre disque affiche le pourcentage, les Go copiés et le fichier en cours.

## 1.0.197 — 20 novembre 2026

- Lumio Auto, Seed : les torrents ajoutés depuis « Torrents qui peuvent rapporter » (ou « Ajouter un torrent ») apparaissent maintenant dans « En partage », marqués « Partage seul », avec l'avancement pendant le téléchargement puis le ratio. Ils ne sont plus retirés au bout de 72 h.

## 1.0.196 — 20 novembre 2026

- Livres : le numéro du tome est bien reconnu même quand le nom du fichier contient une année (« Black Clover 2016 … T33 ») : les tomes sont dans l'ordre et « Continuer le tome 33 » est juste.
- Livres : les mangas prennent la vraie couverture de chaque tome (MangaDex, édition française d'abord) ; une 1re page en noir et blanc n'est plus prise pour la couverture.

## 1.0.195 — 20 novembre 2026

- Lumio réunit maintenant trois univers : **Films & séries** (Jellyfin, toujours en premier), **Livres audio** et **Livres** (livres, BD, mangas). Un bouton en haut de l'accueil permet de passer de l'un à l'autre, et les onglets du bas s'adaptent : Livres audio (bibliothèque, Trouver pour l'admin, Profil), Livres (bibliothèque, Trouver pour l'admin, Profil). Le mini-lecteur des livres audio reste visible partout, et la lecture continue en arrière-plan.
- Les applis séparées Lumio Audio et Lumio Livres ne sont plus mises à jour : tout est dans Lumio. Lumio Auto reste à part pour l'admin.
- Profil (admin) : « Livres et livres audio » pour voir le disque utilisé et déplacer les dossiers.

## 1.0.194 — 19 novembre 2026

- Nouveaux logos pour Lumio Auto (éclair, orange), Lumio Audio (casque, violet) et Lumio Livres (livre, vert) : le même « L » en verre et la même bille que Lumio, chacun dans sa couleur.
- Lumio Auto, Seed : le texte d'aide dit maintenant qu'aucun torrent n'est retiré automatiquement.

- Lumio Livres : les tomes d'une même série sont rassemblés en collections (Kaamelott, Jujutsu Kaisen…), avec une page par collection et « Continuer le tome N ».
- Lumio Audio, admin : « Changer la couverture » sur la fiche d'un livre : images trouvées en ligne ou photo du téléphone.
- Lumio Audio et Lumio Livres : les résultats de l'onglet Trouver ont une vignette de couverture.
- Lumio Audio et Lumio Livres, admin : dans Profil, « Dossier sur le serveur » pour voir le disque utilisé et déplacer les livres sur un autre disque.

## 1.0.192 — 19 novembre 2026

- Nouvelle appli **Lumio Livres** (iPhone et Android) : les livres, BD et mangas de la maison. Bibliothèque avec couvertures, « Continuer la lecture », recherche, filtres et tri ; liseuse intégrée : EPUB chapitre par chapitre (thème sombre, clair ou sépia, taille du texte), BD et mangas page par page (sens manga, zoom), PDF. La page où tu t'es arrêté est gardée sur le serveur, on reprend sur n'importe quel appareil.
- Lumio Livres, admin : onglet « Trouver » pour chercher un livre, une BD, un manga ou un comics sur C411, Tr4ker et Wawacity et le télécharger sur le serveur.

## 1.0.191 — 19 novembre 2026

- Plus de retour à l'écran de connexion après avoir fermé l'appli : la session est gardée à trois endroits (mémoire de l'appli, fichier, trousseau iOS) et réécrite dès que l'appli passe en arrière-plan.

## 1.0.190 — 19 novembre 2026

- Nouvelles icônes : Lumio Audio (livre ouvert avec un casque, violet) et Lumio Auto (compteur, orange) ; celles de Lumio et Lumio TV ne changent pas.

- « Demander » sur un film absent : si un streaming est prêt, tu choisis entre « Regarder maintenant » (la demande part avec) et « Seulement demander ». Plus besoin de lancer un stream pour faire une demande.

## 1.0.189 — 19 novembre 2026

- Nouvelle appli **Lumio Audio** (iPhone et Android) : les livres audio de la maison. Bibliothèque avec couvertures, « Continuer l'écoute », recherche, tri et filtres ; lecteur avec −30 s / +30 s, chapitres, vitesse de 0,8× à 2×, minuterie de sommeil (ou fin du chapitre), lecture en arrière-plan et sur l'écran verrouillé. La position d'écoute est gardée sur le serveur, on reprend sur n'importe quel appareil.
- Lumio Audio, admin : onglet « Trouver » pour chercher un livre audio sur C411, Tr4ker et Wawacity et le télécharger sur le serveur (cache AllDebrid / TorBox d'abord, sinon qBittorrent qui le partage).

## 1.0.188 — 19 novembre 2026

- Titre absent : retour du bouton « Demander » à la place de « Lire ». Pour un film, il cherche d'abord un streaming prêt (cache TorBox / AllDebrid, Wawacity, cherché dès l'ouverture de la fiche) : s'il y en a un, la lecture démarre et la demande part avec ; sinon, la demande s'ouvre comme avant.

- Lecture : quand un film a deux versions sur le serveur (4K et 1080p), « Lire » prend la 4K au lieu de la 1080p.

## 1.0.186 — 18 novembre 2026

- LooStream retiré : le streaming repasse par les caches (TorBox, AllDebrid) et Wawacity en dernier recours. Admin : TorBox (lien direct) puis AllDebrid ; famille : AllDebrid relayé par le serveur, puis TorBox (serveur 3.117.0).
- Titre absent : un seul bouton « Lire ». Il lance le streaming et demande le titre en même temps : chez l'admin, le téléchargement part tout de suite (cache d'abord) ; pour la famille, la demande est validée toute seule si le titre est en cache, sinon elle attend l'admin.
- Titre déjà sur le serveur : plus de bouton « Streaming », « Lire » suffit.
- Lumio Auto, onglet Demandes : bouton « Effacer les demandes terminées / en échec ».

## 1.0.185 — 18 novembre 2026

- Streaming d'une série : le menu permet de choisir la saison et l'épisode à lancer, avec les sources de cet épisode.

## 1.0.184 — 18 novembre 2026

- Fiches d'un titre déjà sur le serveur : « Streaming » devient une barre pleine largeur sous « Lire », au lieu de la petite icône.

## 1.0.183 — 18 novembre 2026

- Fiche Jellyfin (affiches de la bibliothèque) : bouton « Streaming » ajouté, comme sur les fiches TMDB.

- Fiche : un téléchargement par Lumio Secour (Wawacity) affiche sa vraie raison (« Wawacity d’abord (4K) », « DL »…) au lieu de « Radarr ne répond pas » (serveur 3.115.1).

## 1.0.181 — 18 novembre 2026

- Accueil : nouvelle rangée « 🎬 Films du moment », juste sous le haut de l'accueil : films à l'affiche, sorties des 4 derniers mois bien notées et tendances de la semaine, mélangés.

- Streaming : il n'envoie plus de demande au serveur, c'est le rôle du bouton « Demander ». Le bouton « Streaming » reste aussi sur un titre déjà sur le serveur, à côté de « Lire » (serveur 3.115.0).
- Recherche : les fautes d'orthographe sont tolérées (« intersteler » trouve Interstellar), avec « Résultats pour … » quand le titre a été corrigé.

- Calendrier : remplacé par le radar des sorties VOD d'amtVOD (disponible en VOD, sortie confirmée avec le compte à rebours, au cinéma avec la prédiction), lu par le serveur Lumio. Un appui ouvre la fiche du film (serveur 3.114.0).

## 1.0.179 — 18 novembre 2026

- Streaming : LooStream (37 sites de streaming en VF, intégré au serveur Lumio) est essayé en premier ; s'il ne trouve rien, on repart sur les caches (TorBox, AllDebrid) et Wawacity comme avant. Les sources sont cherchées dès l'ouverture de la fiche, pour que le menu et la lecture soient presque immédiats. L'origine s'affiche (« LooStream · site »).
- Fiche d'un titre absent : deux boutons côte à côte, « Demander » (au serveur) et « Streaming ».

## 1.0.178 — 18 novembre 2026

- Lumio Auto, onglet Lecture : quand Jellyfin ne reconnaît plus la session de l'appli, un message clair et un bouton « Se reconnecter » remplacent « Identifiants refusés ou session expirée ».

## 1.0.177 — 17 novembre 2026

- Lumio Auto, onglet Seed : « Soins palliatifs ». Lumio remet tout seul en partage ses anciens torrents C411 dont le film ou les épisodes sont encore dans la bibliothèque (liens durs, aucune place en plus), pour aider les torrents sans source et gagner des Z. Ceux qui ont déjà assez de sources sont retirés au bout de 3 h, les autres après 30 jours au plus. Les Z du compte s'affichent si le profil C411 les donne (serveur 3.111.0).

## 1.0.176 — 17 novembre 2026

- Lumio Auto : onglet « H.265 » et conversion de nuit retirés (serveur 3.110.1).

## 1.0.175 — 17 novembre 2026

- Lumio Auto : nouvel onglet « H.265 ». Les films qui ne sont pas en H.265 sont convertis la nuit (3 h – 6 h, 2 films par nuit, réglables), avec pause si quelqu'un regarde Jellyfin. La 4K, le HDR et les films encore en partage ne sont pas touchés. L'original est supprimé une fois le fichier vérifié. Réglages, file d'attente, « Convertir maintenant », exclusion et historique dans l'onglet (serveur 3.110.0).

## 1.0.174 — 16 novembre 2026

- Fiche d'un titre : la bonne page s'affiche directement (plus de « Streaming » qui se change en « Lire » au bout d'une seconde).

## 1.0.173 — 15 novembre 2026

- Le bouton « Streaming » n'apparaît plus quand le fichier est déjà sur le serveur (« Lire » suffit).

- Lumio Auto : un film pas encore sorti, ou sans aucune version sur les sites, n'apparaît plus dans « Version à choisir » (il attend dans « En attente de sortie »). Serveur 3.109.1.

- Menu « Streaming » : pour 1080p et 720p, des pastilles disent d'où le flux peut venir (TorBox en direct, AllDebrid ou Wawacity par ton serveur). Demande le serveur 3.109.0.
- Bouton « DL » (admin) : choix 4K ou 1080p d'abord, puis les fichiers Wawacity de cette qualité ; affiché aussi quand le titre est déjà sur le serveur.

## 1.0.172 — 15 novembre 2026

- Plus d'interrupteur 4K : le profil (1080p ou 4K) se choisit seulement dans « Demander », et le serveur fait le reste.
- Lumio Auto, onglet Demandes : une seule page simple (à valider, version à choisir, en cours, en échec ; le reste replié).
- Lumio Auto, onglet Seed : le ratio du site en grand, seulement les problèmes s'il y en a, le reste replié.
- Bouton « DL » (admin, titre absent) dans Lumio et Lumio TV : choix d'un fichier Wawacity, téléchargé par le serveur.

- « Demander » : choisir le profil 1080p retire maintenant la 4K du titre (avant, un titre déjà marqué 4K restait en 4K). Demande le serveur 3.108.1.

## 1.0.170 — 15 novembre 2026

- « Demander » en profil 4K (admin) : les fichiers 4K de Wawacity sont proposés d'abord (un fichier pour un film, une version par saison pour une série) ; rien de choisi ou rien de trouvé → C411 en 4K. Les demandes 4K de la famille passent aussi par Wawacity d'abord. Demande le serveur 3.108.0.

## 1.0.169 — 15 novembre 2026

- Streaming : la 4K est retirée du menu (1080p ou 720p). Pastille verte / rouge sur le bouton « Streaming » : vert si au moins un service (TorBox, AllDebrid, Wawacity) marche. Demande le serveur 3.107.0.

- Streaming : l'origine du flux (Wawacity, TorBox ou AllDebrid) s'affiche au lancement de la lecture.

## 1.0.168 — 15 novembre 2026

- Bouton « Streaming » ouvert aux membres de la famille : Wawacity d'abord, puis le cache TorBox, puis AllDebrid (les liens AllDebrid passent par le serveur). Leur streaming ne télécharge rien : une demande arrive à l'admin. Demande le serveur 3.106.0.

## 1.0.167 — 15 novembre 2026

- 4K : le bouton « 4K » de la fiche est remplacé par un choix « Profil : 1080p / 4K H.265 » au moment de « Demander », et au moment de valider dans Lumio Auto. Demande le serveur 3.105.0.

- « Lire » ne sert plus qu'à Jellyfin. Titre absent : « Demander » revient, pour tout le monde.
- Admin : bouton « Streaming » sur chaque fiche (même quand le titre est sur Jellyfin), avec le choix de la qualité (4K, 1080p, 720p). Le serveur cherche dans le cache TorBox / AllDebrid puis sur Wawacity ; un titre absent se télécharge aussi en arrière-plan. Demande le serveur 3.104.0.
- Fiche plus sobre : une seule ligne d'icônes (depuis le début, vu, favori, à voir, streaming, signaler), année · durée · genres sur une ligne.
- Notes de la famille retirées (fiches, affiches, Lumio TV).

## 1.0.166 — 15 novembre 2026

- 4K H.265 sur certains titres (admin) : bouton « 4K » sur la fiche d'un film ou d'une série, et interrupteur dans Lumio Auto. Lumio Auto cherche alors une version 2160p H.265 (HDR10 accepté, Dolby Vision seul refusé), attend qu'elle existe, et la range à côté du 1080p (deux versions dans Jellyfin). Demande le serveur 3.103.0.
- Streaming de l'admin : Wawacity en dernier recours quand rien n'est dans le cache TorBox / AllDebrid (lien ouvert par AllDebrid, relayé par le serveur).

- Demandes de la famille : si une version est dans le cache AllDebrid / TorBox, la demande est validée toute seule et le fichier arrive par le cache (rien de compté sur le site), puis passe en partage. Pas en cache : elle attend l'admin, puis torrent du site. Serveur 3.102.0.

## 1.0.165 — 15 novembre 2026

- Streaming d'un titre absent réservé à l'admin : le serveur cherche dans le cache TorBox (lien direct) puis AllDebrid (vidéo relayée par le serveur, AllDebrid ne voit que son adresse). Les membres qui appuient sur « Lire » envoient une demande. Demande le serveur 3.101.0.
- Quand l'admin lance un streaming, le même torrent se télécharge tout seul sur le serveur par le cache (rien de compté sur le site), puis passe en partage.
- Garde du ratio : bascule sur le cache sous 1,0 de ratio (au lieu de 1,20).
- Lumio Auto, onglet qBittorrent : nouvelle liste « En partage », claire, avec ratio, envoi, origine et une poubelle sur chaque torrent (arrêter le seed ou supprimer aussi le fichier).
- Lumio Auto, onglet Seed : « Torrents qui peuvent rapporter », freeleech d'abord (y compris les périodes freeleech du compte), avec « Ajouter » ; rien n'est pris tout seul.

## 1.0.164 — 13 novembre 2026

- Titre absent du serveur : il ne reste vraiment que le bouton « Lire ». Il lance le streaming si possible, sinon il envoie la demande ; quand le fichier est sur le serveur, le même bouton lit depuis Jellyfin. Demande le serveur 3.100.2.

## 1.0.163 — 13 novembre 2026

- Lumio Auto : le serveur ne prend plus aucun torrent de partage tout seul (booster automatique arrêté). Onglet qBittorrent → « Ajouter un torrent » : recherche sur le site ou lien magnet / .torrent, pour le partage seulement. Demande le serveur 3.100.1.

## 1.0.162 — 13 novembre 2026

- « Lire » sur un titre absent ne lance plus le téléchargement : le streaming démarre si possible, et une demande en attente est envoyée à l'admin (pour tout le monde, admin compris). Demande le serveur 3.100.0.
- Lumio Auto, onglet Demandes : les demandes à valider arrivent en haut, avec deux boutons « Valider » (lance le téléchargement) et « Refuser ».

## 1.0.161 — 13 novembre 2026

- Titre absent du serveur : un seul bouton « Lire », pour tout le monde. Il lance le streaming (cache TorBox) et le téléchargement sur le serveur en arrière-plan, sans validation ni quota ; le bouton « Demander » disparaît pour les films. Demande le serveur 3.99.1.
- Streaming commencé sur un appareil et repris sur un autre (téléphone puis TV) : même lien pendant une heure, à la même position.

- « Regarder » sur un titre absent du serveur (tout le monde) : si son torrent est dans le cache TorBox, la lecture démarre tout de suite en streaming et le fichier se télécharge sur le serveur en arrière-plan. Pas en cache : « Demander » comme avant. Demande le serveur 3.99.0.
- Le bouton « Movix » est retiré : le serveur choisit tout seul le bon chemin.
- Serveur 3.99.0, garde du ratio à 1,20 : sous le seuil, chaque titre est d'abord cherché dans le cache AllDebrid / TorBox (rien de compté sur le site), puis remis en partage par-dessus dans qBittorrent ; pas en cache, torrent du site puis partage.
- Serveur 3.99.0, booster de seed automatique : un passage par heure, freeleech tout le temps, torrents payants très demandés seulement au-dessus de 1,20.
- Serveur 3.99.0 : après 72 h de partage, les torrents restés à 1 de ratio ou moins sont retirés tout seuls (les fichiers de Jellyfin ne bougent pas).
- Lumio Auto, onglet Seed : garde du ratio, vérifications automatiques (qBittorrent, port de partage, torrents cassés, disque du booster), chemin de chaque titre et torrents retirés. Plus aucun bouton pour le booster.

## 1.0.159 — 12 novembre 2026

- Lumio Auto : le quota par jour des sites est retiré (plus de « quota du jour atteint », plus de réglage « Volume maximum par jour »). Demande le serveur 3.98.2.
- Serveur 3.98.1 : booster de seed — un torrent payant n'est « rentable » qu'avec au moins 5 téléchargeurs, trois fois plus de téléchargeurs que de partageurs, et sorti depuis moins de 6 h (15 Go au plus).

## 1.0.158 — 11 novembre 2026

- Le bouton « Movix » s'affiche aussi dans l'appli Lumio pour l'admin (il n'apparaissait que dans Lumio Auto).

## 1.0.157 — 11 novembre 2026

- Bouton « Movix » (admin) sur la fiche d'un titre absent, à la place du petit « DL » vert : il ouvre le choix des fichiers et télécharge sans passer par le tracker. À utiliser quand le ratio est bas ; sinon « Demander » prend le torrent.
- Mode ratio automatique retiré : Lumio Auto ne bascule plus tout seul sur le téléchargement direct. La carte « Service en route » disparaît ; la tuile de l'onglet Perf affiche le ratio du site.
- Lumio Auto → Serveur : carte « Téléchargement direct » pour enregistrer la clé TorBox (gardée sur le serveur).
- Serveur 3.98.0 : téléchargement direct par AllDebrid, puis par TorBox si AllDebrid n'arrive pas à ouvrir le lien.

## 1.0.156 — 11 novembre 2026

- Streaming direct retiré : le bouton « Lire » en streaming sur les titres absents (TorBox) ne marchait pas, tout est revenu comme avant. Titre absent : « Demander » (ou « DL » pour l'admin). La carte « Streaming direct » de Lumio Auto disparaît.
- Serveur 3.97.0 : streaming retiré. Restent : Lumio Secour résout les sites par le DNS 1.1.1.1 (Movix et Wawacity ne répondaient pas avec le DNS de la box), et les demandes des membres ne se lancent plus toutes seules (l'admin reçoit une notification et valide).

## 1.0.154 — 11 novembre 2026

- « Regarder » sur un titre absent du serveur : Lumio trouve un lien (Movix, Wawacity), TorBox (sinon AllDebrid) le lit tout de suite, et le titre se télécharge en même temps en arrière-plan pour toute la famille. La suite d'une série s'enchaîne de la même façon. Réglage dans Lumio Auto → Serveur → « Streaming direct » (clé TorBox gardée sur le serveur). Demande le serveur 3.94.0.

## 1.0.153 — 11 novembre 2026

- Lumio Auto, booster de seed : « Meilleurs torrents en ce moment » — la liste des torrents les plus intéressants d'après les chiffres de C411 (téléchargeurs, partageurs, taille, gratuit ou payant, gain estimé), avec un bouton « Prendre » pour chacun. Nouvelle option, éteinte par défaut : prendre aussi des torrents payants très demandés, dans une limite par semaine. Demande le serveur 3.93.0.
- Serveur 3.92.3 : onglet DL et mode ratio — Wawacity (wawacity.rentals) ajouté à côté de Movix. C411 : le vrai ratio et les périodes freeleech du compte sont lus sur le profil du site (clé API avec le droit « Profil (lecture) ») ; le booster démarre dès qu'un freeleech commence et cherche sur les 300 dernières sorties.

## 1.0.152 — 11 novembre 2026

- Lumio Auto : trois nouveaux onglets dans la barre du bas. « Disques » (place libre de chaque disque, recherche d'un film ou d'une série, fichiers, téléchargements, stockage), « Serveur » (scanner, redémarrer, mettre à jour) et « Lecture » (qui regarde quoi : affiche, avancement, temps restant et heure de fin, compte, appareil, à la maison ou à distance, lecture directe ou conversion, statistiques). L'onglet Perf devient une vue d'ensemble : trois tuiles (lectures, service en route, place libre), le booster, puis la machine et les services.
- Serveur 3.92.2 : le booster de seed rend sa place tout seul quand le disque passe sous 20 Go libres.

## 1.0.151 — 11 novembre 2026

- Source FlareStore « Lumio » : Lumio iOS (version Nuvio) y apparaît aussi, à côté de Lumio et Lumio Auto ; elle se met à jour toute seule toutes les 2 heures.
- Lumio Auto, onglet Ratio : nouvelle carte « Service en route » (torrents, freeleech ou Movix : ce qui tourne en ce moment, ratio de chaque site, réglage du seuil, téléchargements en cours, dernières bascules) et carte « Booster de seed » (place utilisée, torrents en partage, envoyé, prochaine sélection, bouton pour en lancer une). Demande le serveur 3.92.1.
- Serveur 3.92.0 : mode ratio — sous 1,10 sur un site, Lumio Auto ne prend plus que du freeleech, sinon le lien Movix par AllDebrid (rien ne compte dans le ratio), et revient aux torrents tout seul au-dessus de 1,15. Booster de seed : une fois par semaine, quelques torrents freeleech très demandés sont pris seulement pour partager (200 Go sur jellyfin3).
- Serveur 3.91.1 : onglet DL — nouvelle adresse de Movix (movix.miami) posée toute seule dans Lumio Secour après la mise à jour du serveur.

## 1.0.150 — 8 novembre 2026

- Serveur 3.91.0 : après un téléchargement, la fiche affiche « Ajout dans la bibliothèque… » (100 %) jusqu'à ce que Jellyfin voie le fichier, puis passe toute seule à « Lire » (bibliothèque relue toutes les 10 s pendant ce temps).

## 1.0.149 — 8 novembre 2026

- Lumio Auto : la gestion des disques (parcourir, ranger, déplacer, supprimer) et les téléchargements AllDebrid sur les disques sont de retour, dans l'onglet Performance et dans Réglages → Torrents.
- Lumio Auto : « Chercher dans les bibliothèques » trouve un film ou une série, puis l'ouvre pour le supprimer, le déplacer, modifier ses infos ou le rescanner.

- Demandes : la TV (et les autres applis) peuvent de nouveau demander les films et séries absents. Le serveur cherchait les identifiants des titres dans Radarr et Sonarr, qui n'existent plus ; il les prend maintenant sur TMDB. Il faut le serveur Lumio 3.90.0.

## 1.0.148 — 8 novembre 2026

- Lumio Auto réorganisée en quatre onglets :
  - Performance : services, machine, qui regarde quoi, mises à jour et redémarrages, disques ;
  - Seed : ratio et marge par site, torrents en partage, réglages du partage ;
  - Demandes : les demandes, les titres suivis par Lumio Auto, les épisodes manquants ;
  - qBittorrent : interrupteurs, téléchargements en cours, historique, tous les torrents.
  Les réglages sont derrière la roue, en haut à droite de chaque onglet.

## 1.0.147 — 8 novembre 2026

- Lumio Auto redessinée, pour la gestion du serveur seulement. Quatre onglets :
  - Tableau : état des services, les deux interrupteurs, téléchargements, partage, versions à choisir, demandes en attente, ratio et marge C411, quota du jour, qui regarde quoi ;
  - Torrents ;
  - Demandes ;
  - Réglages, rangés en Serveur, Torrents, Famille, Compte et clés.
  Plus d'Accueil, de Live TV, de Recherche ni de « À voir ».
- Lumio : l'onglet Auto n'apparaît plus. Les onglets cachés réapparaissaient à cause d'un bug de la barre d'onglets, corrigé.

## 1.0.146 — 8 novembre 2026

- Nouvelle appli **Lumio Auto** pour l'admin, sur iPhone et Android, avec une icône orange. Elle a quatre onglets :
  - Auto : Titres, Manquants, Transferts, qBittorrent, Ratio ;
  - Demandes : validation des demandes ;
  - Bibliothèque : les actions d'admin sur les titres ;
  - Serveur : état, mises à jour du serveur, stockage, utilisateurs et quotas, annonces, signalements, Lumio Secour, clé TMDB, compte.
  Elle s'installe depuis la même source FlareStore que Lumio, ou avec l'APK lumio-auto-android.apk.
- Lumio devient l'appli de la famille : plus d'onglet Auto ni d'outils d'admin. L'admin y trouve juste un bouton « Ouvrir Lumio Auto » dans le Profil.

## 1.0.145 — 8 novembre 2026

- Auto → Ratio : la marge de téléchargement C411 s'affiche (envoyé ÷ 0,8 − reçu), avec une alerte sous 10 Go. Sans tes chiffres du site, la carte précise maintenant qu'elle ne montre que les torrents de Lumio.

- Lumio Auto : la langue indiquée par le site (C411 : « Multi VF2 (FR + QC inclus) ») est maintenant prise en compte, en plus du nom de la version. Un « MULTi » qui contient du québécois est refusé. Il faut le serveur Lumio 3.89.0.

- Lumio Auto : plus aucune version avec une piste québécoise. Lumio refuse VFQ, VF2 (VFF + VFQ), QC, VQ, French-Canadian, même dans un MULTI qui a aussi une piste VFF. Pour en accepter de nouveau, coche VFQ ou VF2 dans les langues. Il faut le serveur Lumio 3.88.0.

## 1.0.144 — 7 novembre 2026

- Auto : nouvel onglet « Ratio ». Pour chaque site (C411…), il affiche ton ratio, l'envoyé, le reçu (le freeleech à part), le quota du jour avec une jauge, les 7 derniers jours et les torrents encore sous la règle des 72 h. Une alerte orange s'affiche si le ratio approche de 1 ou si le quota est presque atteint. Entre une fois les chiffres de ton profil du site pour avoir ton vrai ratio, Lumio ajoute ensuite tout seul ce qu'il envoie et reçoit.
- Auto : les interrupteurs Lumio Auto et AllDebrid sont maintenant dans Réglages (Profil → Lumio Auto). Une petite ligne d'état reste en haut de l'onglet Auto. Il faut le serveur Lumio 3.87.0.

## 1.0.143 — 7 novembre 2026

- Auto → Manquants : tu choisis maintenant les épisodes à lancer (touche E4, E5… puis « Lancer »). Le bouton « Toute la saison » demande une confirmation. Il faut le serveur Lumio 3.86.0.

## 1.0.142 — 6 novembre 2026

- Demandes : nouveau quota pour protéger le ratio. Chaque membre peut demander 2 films et 1 série par semaine (une série compte pour une demande, quel que soit le nombre de saisons). L'admin n'a pas de limite. Réglable dans Utilisateurs. Il faut le serveur Lumio 3.85.0.

## 1.0.141 — 6 novembre 2026

- Auto : nouvel onglet « Manquants ». Il liste tes séries avec les saisons et les épisodes déjà sortis qui manquent. Rien ne part tout seul : touche « Lancer » sur une saison, ou « Ne plus proposer » pour masquer une série. Les nouveaux épisodes des séries en cours restent suivis automatiquement, comme Sonarr. Il faut le serveur Lumio 3.84.0.

## 1.0.140 — 5 novembre 2026

- Widget : il ne reste plus bloqué en gris. Plus besoin de coller une clé : il affiche directement les torrents en partage (vitesse, nombre, Go envoyés, envoi du jour) et le nombre de lectures en cours. Il faut le serveur Lumio 3.83.0.

## 1.0.139 — 5 novembre 2026

- Profil : la rubrique « Widget » (copier la clé du widget) est maintenant bien en vue, juste sous l'état des serveurs.


## 1.0.138 — 5 novembre 2026

- Widget (admin) : le partage et « qui regarde quoi » s'affichent même avec FlareStore. Dans Profil → Widget, touche « Copier la clé du widget ». Ensuite, fais un appui long sur le widget → Modifier le widget → Clé admin, et colle la clé. Le widget demande maintenant iOS 17 ou plus récent.


## 1.0.137 — 5 novembre 2026

- Accueil : la grande image n'affiche plus deux titres. Lumio prend une affiche sans texte et garde un seul titre, le logo, plus lisible.
- Plateformes : nouvelles vignettes avec l'icône officielle en couleur et la couleur de chaque marque. Canal+ n'apparaît plus comme un gros « − ».
- Widget (admin) : les torrents en partage, avec la vitesse d'envoi, le total envoyé en Go et l'envoi du jour. Il affiche aussi qui regarde quoi en ce moment.
- Auto, plus simple :
  - trois onglets : Titres, Transferts, qBittorrent ;
  - les sites et les réglages sont dans Profil → Lumio Auto, ou via le bouton « Réglages » en haut ;
  - l'onglet Titres est revu en listes claires : À choisir, En cours, En attente et Complets ;
  - chaque bloc se replie d'un appui ;
  - l'Historique a un bouton « Tout supprimer » : les films restent dans la bibliothèque et le partage continue.
- Il faut le serveur Lumio 3.82.0.

## 1.0.136 — 4 novembre 2026

- Admin : petite pastille « ↑ sources ↓ téléchargeurs » en bas des affiches (accueil, bibliothèque, recherche), avec un point vert quand le titre est en partage. Chiffres de qBittorrent pour ce qui est en partage, sinon ceux de la dernière recherche de Lumio Auto. Jamais pour la famille ni sur la TV. Il faut le serveur Lumio 3.81.0.

## 1.0.135 — 4 novembre 2026

- qBit → Réglages du partage, trois interrupteurs simples : « Envoi à fond la nuit (1 h – 8 h) », « Partage intelligent » (un torrent encore demandé reste en partage, un torrent que plus personne ne demande depuis 14 jours est retiré) et « Résumé chaque soir (21 h) » en notification (envoyé, reçu, partages, quota). Règle C411 respectée : jamais de retrait avant 72 h de partage ou un ratio de 1 sur le torrent, et alerte « Hit & Run » si on veut en supprimer un trop tôt. Nombre de personnes qui téléchargent chaque torrent. Il faut le serveur Lumio 3.80.0.
- « Derniers ajouts » : seulement les films et les séries de l’année en cours et des suivantes (plus d’anciennes séries qui reçoivent une nouvelle saison, plus de repli sur l’année d’avant).

## 1.0.133 — 4 novembre 2026

- Onglet Auto → qBit → « Réglages du partage » : bouton « Partager un maximum » (tous les torrents partagent en même temps), file d’attente et nombre de torrents actifs, vitesses d’envoi et de réception, envois en même temps, et objectif de partage de Lumio (ratio et durée minimum). Il faut le serveur Lumio 3.79.0.

## 1.0.132 — 4 novembre 2026

- Onglet Auto : deux interrupteurs. « Lumio Auto » met en pause ou relance la recherche automatique (ce qui est lancé continue et reste en partage) ; « AllDebrid » choisit entre les versions déjà en cache AllDebrid (instantané, ratio intact) et les torrents par qBittorrent. Il faut le serveur Lumio 3.78.0.

## 1.0.131 — 4 novembre 2026

- Widget « État des serveurs » : qBittorrent et le VPN à la place de Radarr / Sonarr (qui ne reviennent plus, même Lumio Auto éteint). Il faut le serveur Lumio 3.77.0.

## 1.0.129 — 4 novembre 2026

- Interrupteur de Lumio Auto éteint = mode AllDebrid : il cherche toujours sur tes sites (C411…) mais ne prend que les versions déjà en cache chez AllDebrid (instantané, ratio intact) ; ce qui est déjà lancé finit de se télécharger, se range et reste en partage. Rallumé = retour aux torrents par qBittorrent. Il faut le serveur Lumio 3.76.0.
- Onglet Auto → « qBit » : tous les torrents de qBittorrent (téléchargement, partage, ratio, sources), vitesses et port du VPN en direct, et actions (pause, reprise, vérifier, relancer les trackers, retirer ou supprimer avec les fichiers, vitesse réduite). Services surveillés : qBittorrent et le VPN à la place de Radarr / Sonarr. Séries : seulement la saison en cours, une nouvelle saison se demande. Il faut le serveur Lumio 3.75.0.

## 1.0.128 — 4 novembre 2026

- Ratio protégé : les séries en cours reprises de la bibliothèque ne téléchargent plus que les nouveaux épisodes (plus de rattrapage d’un coup), volume maximum par jour et par site (15 Go par défaut sur C411, freeleech non compté et toujours préféré), et partage gardé jusqu’au ratio ET à la durée minimum (au plus 60 jours). Il faut le serveur Lumio 3.74.0.

## 1.0.127 — 3 novembre 2026

- Lumio Auto remplace Radarr, Sonarr et Prowlarr (nouvel onglet admin « Auto », jamais sur la TV). Il cherche chaque demande validée sur tes sites (C411, TR4KER…) par identifiant TMDB / IMDb, prend la version la plus légère en français 1080p (H.265 de préférence, attente puis remplacement automatique du H.264), et la range dans la bonne bibliothèque. Il faut le serveur Lumio 3.71.0.
- Onglet Auto clarifié en quatre rubriques : Titres (à choisir, en cours, suivis ; fiche avec historique, recherches site par site et recherche interactive façon Radarr), Transferts (file d’attente avec vitesse et temps restant, « En partage » avec le ratio, historique), Sites (C411, Torznab, Prowlarr ; client au choix par site) et Réglages (qualité, qBittorrent et partage, AllDebrid, dossiers, liste noire, journal).
- Téléchargement avec qBittorrent derrière le VPN (ProtonVPN via Gluetun) puis partage jusqu’au ratio ou à la durée choisis, rangement par lien dur (aucune place en plus), port du VPN recopié tout seul. AllDebrid reste disponible.
- Onglet Demandes minimaliste : juste les demandes, une ligne par titre (affiche, statut en couleur, ✓ / ✕ pour valider, autres actions dans « … »). Plus aucune mention de Radarr / Sonarr.
- Profil plus rangé : « Compte et serveur » (Jellyfin, Serveur Lumio, Serveur, Stockage, Idées & signalements) et « Application » (Accueil, TMDB, Lecture, version). Stockage d’après les dossiers des disques, saisons des séries d’après TMDB.
- Vignette dédiée pour les Collections dans la Bibliothèque.

## 1.0.126 — 2 novembre 2026

- Profils de la famille : quand tu te connectes avec le compte admin, un écran « Qui regarde ? » te propose ton profil, celui des enfants, de ta femme… Chaque profil a sa propre reprise, ses « vus » et sa liste « À voir ». Un profil enfant peut être limité à certaines bibliothèques et à un âge maximum, et chaque profil peut avoir un code à 4 chiffres. Tu changes de profil dans Profil → Changer de profil. Il faut le serveur Lumio 3.64.0.
- Fenêtre Demander redessinée : plus compacte, saisons et dossiers en pastilles rondes, infos en petites étiquettes, un seul bouton Demander.

## 1.0.125 — 2 novembre 2026

- Lecture toujours en qualité d'origine : le choix 1080p / 720p / 480p est retiré (la conversion par le serveur prenait trop de processeur).

## 1.0.124 — 1 novembre 2026

- Icône iPhone : fond aux couleurs floues (bleu, cyan, violet) derrière le L et la bille de lumière en verre, comme sur Lumio TV.

## 1.0.123 — 1 novembre 2026

- Nouvelle icône de l'appli : un « L » et une bille de lumière en verre. Sur iOS 26, c'est une vraie icône en couches à laquelle iOS applique son effet de verre. Sur Android, l'icône adaptative et l'icône monochrome suivent le même dessin.

## 1.0.122 — 1 novembre 2026

- Lecteur : quand tu changes de qualité ou que tu fermes la vidéo, la conversion en cours sur le serveur est arrêtée (avant, elle continuait jusqu'à la fin du film et pouvait bloquer les autres lectures).

## 1.0.121 — 1 novembre 2026

- Accueil plus fluide : les rangées (nouveautés, Reprendre, À suivre, tendances, catalogues, coups de cœur) s'affichent tout de suite depuis la dernière ouverture, puis se mettent à jour. Revenir sur l'accueil ne recharge plus tout pendant une minute.

## 1.0.120 — 1 novembre 2026

- Qualité 720p / 480p : la vidéo est vraiment réencodée à la qualité choisie (avant, Jellyfin gardait souvent l'image d'origine).
- Lecteur : la barre ne part plus dans tous les sens quand tu la fais glisser ou que tu avances / recules plusieurs fois de suite.

## 1.0.119 — 31 octobre 2026

- Déplacer : Lumio ne propose plus jamais de déplacer un dossier de bibliothèque entier (KIDS, FILMS…). Un film rangé directement dans sa bibliothèque se déplace seul.
- Déplacer : le texte des choix ne se chevauche plus.

## 1.0.118 — 31 octobre 2026

- Bibliothèques : chaque bibliothèque n'affiche plus que ses propres titres, aussi avec Jellyfin 12 (le lien entre une bibliothèque et ses dossiers se fait aussi par son nom). Plus de doublons en faisant défiler. Il faut le serveur Lumio 3.60.0.

## 1.0.116 — 31 octobre 2026

- Accueil et Bibliothèque : chaque bibliothèque n'affiche plus que ses propres titres (plus de films dans « Séries » ni de films pour adultes dans « Kids »). Il faut le serveur Lumio 3.60.0.

- Déplacer : si Jellyfin n'est pas à jour (titre déjà déplacé), Lumio retrouve le vrai emplacement sur le disque au lieu d'afficher l'erreur « ENOENT ».

## 1.0.114 — 31 octobre 2026

- Bouton Déplacer (admin), sur la fiche Jellyfin et sur la fiche d'un titre : déplace le dossier ou le fichier seul où tu veux, sur n'importe quel disque. Tu peux parcourir les dossiers et en créer un. Marche aussi pour les titres que Radarr et Sonarr ne gèrent pas.

## 1.0.113 — 31 octobre 2026

- Bibliothèques : un même film ou une même série ne s'affiche plus plusieurs fois en faisant défiler la liste.

## 1.0.112 — 31 octobre 2026

- L'onglet Book est retiré de l'appli.

## 1.0.111 — 31 octobre 2026

- Nouvel onglet Book : recherche de mangas, BD, comics, livres et livres audio sur C411, Tr4ker et Wawacity. Les résultats sont rangés par tome et par collection. Le téléchargement passe par AllDebrid et arrive sur le disque du serveur.
- Lecteurs intégrés à l'appli : BD et mangas (sens de lecture, zoom, reprise à la bonne page), livres EPUB (taille du texte, thèmes, sommaire), PDF et livres audio (±30 s, vitesse, lecture en arrière-plan).
- Réglages Book (admin) : clés C411 et Tr4ker gardées sur le serveur, dossier des livres.
- Fiche d'un film ou d'une série : bouton Déplacer (admin) pour le changer de dossier. Radarr ou Sonarr déplacent les fichiers.
- Menu Thèmes de la recherche : pastilles rondes.
- Profil : les parties TMDB et Serveur Lumio sont masquées pour les non-admins.

## 1.0.110 — 28 octobre 2026

- Plateformes : vignettes noires en verre (Liquid Glass sur iOS 26) avec les logos en blanc, façon Apple TV.
- Page d'une plateforme : sorties mélangées (déjà sur ton serveur ou à demander, avec une pastille) et triées par date de sortie.

## 1.0.109 — 28 octobre 2026

- Accueil : rangée « Plateformes » (Netflix, Disney+, Prime Video, Apple TV+, Max, Canal+). Un appui ouvre la plateforme : ses titres sur ton serveur, puis ses dernières sorties (celles qui manquent se demandent depuis leur fiche). Tri du plus récent au plus ancien, ou l'inverse.
- Profil → Serveur : la mise à jour des conteneurs affiche son avancement en pourcentage, avec l'étape en cours.
- Vibrations au toucher coupées par défaut ; réglage « Vibrations au toucher » dans Profil → Lecture pour les remettre.
- Affiches : plus de pastille bleue (nombre d'épisodes non vus) sur les séries.
- Intro Skipper retiré (bouton d'installation dans Profil → Serveur).

## 1.0.108 — 28 octobre 2026

- Accueil : ton nom de profil avec l'écusson de ton rang (10 rangs, du bois à l'or) à la place de « Lumio » ; un appui ouvre tes stats.
- Stats : ton rang, tes points, ta progression et tous les rangs avec leurs bonus ; chaque rang donne des demandes en plus sur ton quota (films et saisons).
- Fiche plus claire : une ligne d'actions (Lire ou « À voir », puis Proposer et « DL »), genre dans les pastilles, résumé sur 3 lignes avec « Plus », 2 avis de la famille affichés.
- Lumio Secour (admin) : bouton « DL » sur les fiches des titres pas encore disponibles et sur les demandes bloquées ou en échec — « Automatique » télécharge le meilleur fichier, ou choix de la source puis du fichier. Suivi dans Demandes.
- Groupe de secours : si Radarr ou Sonarr ne répondent plus du tout, les demandes validées sont téléchargées par Lumio Secour (AllDebrid → disques).
- Lumio Secour : Movix seulement, sites contrôlés une fois par nuit, nouvelle adresse suivie toute seule (notification à l'admin). Réglages et recherche dans Disques (engrenage) ; plus d'onglet Lumio Secour ni de bouton « Liens ».
- Profil → Serveur (admin) : « Mettre à jour les conteneurs » (dernières versions de tes conteneurs, résultat sous le bouton).

## 1.0.107 — 25 octobre 2026

- Stockage : la liste « À nettoyer » (titres jamais ou plus regardés proposés à la suppression) est retirée ; il reste la place des disques et les plus gros fichiers, à supprimer soi-même si besoin.

## 1.0.106 — 24 octobre 2026

- Demandes : deux blocs repliables (+ / −) en haut — « Téléchargements sur les disques » (progression des téléchargements AllDebrid, admin) et « En attente dans Radarr / Sonarr » (films et séries surveillés pas encore téléchargés, avec leur état).
- « À voir » : signet à côté de Lire / J'aime sur les fiches (un appui ajoute, un autre retire) ; sur les affiches de la liste, date de sortie en numérique (films) ou du prochain épisode (séries).
- Recherche par thème : tous les titres du thème, du plus récent au plus ancien, sans limite (chargement au fil du défilement). Nouveau thème 🏰 Disney (Walt Disney, Disney Animation, Pixar : classiques et nouveautés).
- Récompenses (Profil → Récompenses) : points, grades (Spectateur → Légende), badges et classement de la famille, selon les heures regardées, les notes, les J'aime, les demandes, le chat et « À voir ».
- Rangée de saison (🎃 Halloween…) : les titres du serveur, puis des idées qu'on n'a pas encore, à demander depuis leur fiche (serveur Lumio 3.41.0).

## 1.0.105 — 24 octobre 2026

- « Changer le numéro de cette saison » : garder le même numéro range les fichiers de la saison dans leur dossier « Season NN » (ex. vidéos S02 restées dans un dossier « Lupin.S03… ») (serveur Lumio 3.39.0).

- Serveur Lumio 3.37.0 : « Changer le numéro de cette saison » retrouve les fichiers même quand le serveur voit les disques à un autre chemin que Jellyfin, et range les épisodes d'un dossier de sortie (« Lupin.S03… ») dans « Season 02 ».

## 1.0.104 — 24 octobre 2026

- Fiche d'une série (admin) : « Changer le numéro de cette saison » sous les saisons (ex. Saison 3 → 2). Les fichiers sont renommés par Sonarr s'il gère la série, sinon directement sur le disque, puis Jellyfin se met à jour (serveur Lumio 3.36.0).

## 1.0.103 — 23 octobre 2026

- Les saisons vides (dossier resté vide après un déplacement de fichiers) ne s'affichent plus dans la liste des épisodes.

## 1.0.102 — 23 octobre 2026

- Bouton « Séries : numérotation TheTVDB » retiré.

- La version Mac n'est plus compilée ni publiée.

- Téléchargements (admin) : bouton « Envoyer un fichier .torrent » pour choisir un .torrent sur le téléphone ; il passe par AllDebrid puis arrive sur le disque et le dossier choisis, comme les magnets (serveur Lumio 3.34.0).

- Séries sorties en « parties » (Lupin, La Casa de Papel…) : le serveur Lumio repère tout seul les épisodes que Sonarr a rangés au mauvais endroit (sorties numérotées par partie) et les remet à leur place, toutes les 6 h, avec une notification. Sur la fiche, l'admin voit « X épisodes mal rangés » et peut réparer tout de suite (serveur Lumio 3.33.0).

## 1.0.99 — 23 octobre 2026

- Bouton « Remplacer toutes les métadonnées par TMDB » retiré (il mélangeait les épisodes des séries découpées autrement sur TMDB, comme Lupin).

- Séries découpées différemment sur TMDB et dans Sonarr (ex. Lupin) : les fiches listent maintenant les saisons comme Sonarr (TheTVDB), les statuts et les demandes ne se mélangent plus. Profil → Serveur : « Séries : numérotation TheTVDB » règle Jellyfin pour que les épisodes soient aussi dans le bon ordre (serveur Lumio 3.32.0).

## 1.0.97 — 23 octobre 2026

- « À voir » marche même si le serveur Lumio n'est pas encore à jour (plus d'erreur « introuvable ») : la liste est gardée sur le téléphone, puis envoyée au serveur dès qu'il est en 3.31.0 ou plus.

## 1.0.96 — 23 octobre 2026

- « À voir » devient une simple liste de rappel : plus de statut de disponibilité, filtres Tout / Films / Séries ; on ouvre la fiche pour regarder ou demander.

## 1.0.95 — 23 octobre 2026

- Nouvel onglet « À voir » : ta liste de films et séries à ne pas oublier (disponibles ou pas encore sur le serveur), avec filtres Disponibles / Pas encore là / Films / Séries. Bouton « Ajouter à « À voir » » sur chaque fiche. La liste est gardée sur le serveur Lumio : la même sur tous tes appareils.
- Admin : supprimer une demande déjà partie propose « Arrêter et retirer de Radarr / Sonarr (garder les fichiers) », « Tout supprimer, fichiers compris » ou « Retirer de la liste seulement » ; les téléchargements en cours sont annulés (serveur Lumio 3.31.0).
- Correction : le fond TMDB de secours s'affichait parfois à la place de l'image de fond.

- L'ancienne appli TV (React Native) est abandonnée : seule Lumio TV reste. `lumio.wawanono.lol/tv` installe maintenant Lumio TV (serveur Lumio 3.30.1).

## 1.0.94 — 23 octobre 2026

- Profil → Serveur : « Installer Intro Skipper » installe l'extension dans Jellyfin, redémarre Jellyfin puis lance l'analyse tout seul (serveur Lumio 3.30.0).

- Profil : toutes les sections sont repliées, « + » / « − » pour ouvrir ou fermer chacune, « Tout ouvrir / Tout fermer » en haut.
- Lecteur : bouton « Passer l'intro / le récap / le générique » quand Jellyfin a détecté ces passages (extension « Intro Skipper »), aussi sur Lumio TV.
- Profil → Stockage (admin) : place libre sur chaque disque, titres jamais regardés depuis 6 mois ou plus regardés depuis un an, plus gros titres ; on coche et on supprime (fichiers, Radarr / Sonarr, Jellyfin). Notification quand un disque passe sous 10 % de place libre. Les disques s'affichent aussi sur Lumio TV (serveur Lumio 3.29.0).

## 1.0.92 — 22 octobre 2026

- Sous-titres français : dans le lecteur (bouton des pistes), « Chercher des sous-titres français » trouve et ajoute des sous-titres OpenSubtitles en direct. Le serveur Lumio en ajoute aussi tout seul aux nouveaux films et épisodes sans sous-titres ni audio français (plugin « Open Subtitles » de Jellyfin requis) ; ils apparaissent ensuite partout, Lumio TV comprise.
- Fond de l'accueil au choix (Profil → Personnalisation) : titres du serveur, selon la saison, Halloween, Noël ou une photo de la galerie.
- iPhone : appui long sur la barre d'onglets → loupe en verre façon iOS 26 qui suit le doigt ; on relâche sur l'onglet voulu. (Personnaliser la barre : Profil → Personnalisation → Accueil et onglets.)
- Demandes plus fiables : une saison déjà surveillée mais vide est de nouveau recherchée par Sonarr, les demandes en échec sont renvoyées automatiquement (3 essais sur 24 h), et le serveur ne s'arrête plus sur une erreur imprévue (c'est ce qui donnait « serveur injoignable / redémarrage »). L'appli ne bascule plus en mode hors serveur sur une coupure brève (serveur Lumio 3.28.0).

## 1.0.91 — 22 octobre 2026

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
