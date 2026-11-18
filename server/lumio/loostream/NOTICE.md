# LooStream intégré à Lumio serveur

Ce dossier contient le code de **[LooStream](https://github.com/Loo-stick/loostream)** (© les auteurs de LooStream),
licence **MIT** (voir `LICENSE`), commit `a8732ea` (10 novembre 2026, version 1.31.0).

## Ce que Lumio en fait
- Le serveur Lumio construit LooStream dans son image Docker et le lance lui-même (port interne 7012, clé d'accès tirée au hasard,
  gardée dans la config du serveur). Il n'est jamais exposé tel quel : Lumio lui demande les liens d'un titre (numéro TMDB)
  et relaie seulement ses chemins de lecture (`/proxy/…`, `/netmirror/…`, `/moviebox/…`…).
- Les réglages vivants (domaines des sites, qui changent souvent) sont dans `/data/loostream/config` ; Lumio les reprend
  chaque jour depuis le dépôt LooStream.
- Retirés : bot Telegram, service JA3 (vidzy), tests, documentation.

## Mettre à jour le code
Recopier `src/`, `config/`, `package.json`, `package-lock.json` et `tsconfig.json` depuis le dépôt LooStream, sans les `*.test.ts`.
