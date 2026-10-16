# Notes de version de Lumio

Chaque build publiée sur `main` devient une version `1.0.<n° de build>`.
Les nouveautés en préparation s'écrivent sous « À venir » : à la publication, la section est renommée
automatiquement avec le numéro de version et la date, et sert de notes dans l'appli, dans FlareStore et sur la Release GitHub.

## À venir

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
