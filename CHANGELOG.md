# Notes de version de Lumio

Chaque build publiée sur `main` devient une version `1.0.<n° de build>`.
Les nouveautés en préparation s'écrivent sous « À venir » : à la publication, la section est renommée
automatiquement avec le numéro de version et la date, et sert de notes dans l'appli, dans FlareStore et sur la Release GitHub.

## À venir

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
