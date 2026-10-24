// Génère la source AltStore (compatible FlareStore, SideStore, ESign…) pour la dernière build.
// Usage : node scripts/make-source.mjs <version> <tag> <ipa>
// Bêta : SOURCE_KIND=beta → « Lumio Bêta », identifiant lol.wawanono.lumio.beta, fichier altstore-beta.json
import { statSync, writeFileSync } from 'node:fs';

const [version, tag, ipa = 'lumio-unsigned.ipa'] = process.argv.slice(2);
const repo = process.env.GITHUB_REPOSITORY || 'nono7444/lumio';
const size = statSync(ipa).size;
const date = new Date().toISOString();
// Notes : message du commit sans les lignes d'attribution, limité à quelques lignes
const notes = (process.env.RELEASE_NOTES || '')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !/^(Co-Authored-By|Claude-Session|Merge branch)/i.test(l))
  .slice(0, 15)
  .join('\n');
const downloadURL = `https://github.com/${repo}/releases/download/${tag}/${ipa}`;
const beta = process.env.SOURCE_KIND === 'beta';
const out = beta ? 'altstore-beta.json' : 'altstore.json';
const iconURL = `https://raw.githubusercontent.com/${repo}/main/assets/images/icon.png`;

const source = {
  name: beta ? 'Lumio Bêta' : 'Lumio',
  identifier: beta ? 'lol.wawanono.lumio.beta.source' : 'lol.wawanono.lumio.source',
  // Bêta : adresse fixe (pré-version « beta-source », mise à jour à chaque build bêta)
  sourceURL: beta ? `https://github.com/${repo}/releases/download/beta-source/altstore-beta.json` : `https://github.com/${repo}/releases/latest/download/altstore.json`,
  subtitle: 'Jellyfin, Radarr et Sonarr dans ta poche',
  iconURL,
  tintColor: '#3D8BFF',
  apps: [
    {
      name: beta ? 'Lumio Bêta' : 'Lumio',
      bundleIdentifier: beta ? 'lol.wawanono.lumio.beta' : 'lol.wawanono.lumio',
      developerName: 'Norman',
      subtitle: 'Ton cinéma maison',
      localizedDescription:
        'Lecture Jellyfin avec mpv, demandes de films et séries (Radarr / Sonarr), calendrier des sorties numériques, chat famille.',
      iconURL,
      tintColor: '#3D8BFF',
      category: 'entertainment',
      // Champs « historiques » encore lus par certains stores
      version,
      versionDate: date,
      downloadURL,
      size,
      versions: [{ version, buildVersion: version.split('.').pop(), date, size, downloadURL, minOSVersion: '16.4', localizedDescription: notes || `Build ${tag}` }],
      appPermissions: { entitlements: [], privacy: {} },
    },
  ],
  news: [],
};

writeFileSync(out, JSON.stringify(source, null, 2));
console.log(`${out} : Lumio ${version} → ${downloadURL} (${size} octets)`);
