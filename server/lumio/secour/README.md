# Lumio Secour (moteur intégré)

Fork de [WAStream](https://gitlab.com/10ho/wastream) v3.9.1 (licence MIT, voir `LICENSE`), transformé en moteur interne du serveur Lumio.

Changements par rapport à WAStream :

- plus d'addon Stremio : routes Stremio, page de configuration, tableau de bord web, images et vidéos supprimés ;
- API privée `/lumio/*` (`lumio_secour/api/lumio.py`) protégée par `LUMIO_API_KEY`, à l'écoute seulement sur 127.0.0.1 ;
- la clé AllDebrid arrive à chaque appel (`X-Debrid-Key`), elle n'est jamais enregistrée ; le jeton TMDB peut venir du serveur Lumio (`X-Tmdb-Key`) ;
- TMDB : clé v3 ou jeton v4 acceptés ;
- package renommé `lumio_secour`, `selectolax<1` (l'API utilisée a été retirée de selectolax 1.0).

Lancé par `server.js` (voir `../README.md`). Les réglages possibles sont listés dans `settings.example.env` :
dans le compose de Lumio, ajoute le préfixe `SECOUR_` (ex. `SECOUR_WAWACITY_URL`).
