// Génère la source AltStore (compatible FlareStore, SideStore, ESign…) pour la dernière build.
// Usage : node scripts/make-source.mjs <version> <tag> <ipa>
import { statSync, writeFileSync } from 'node:fs';

const [version, tag, ipa = 'lumio-unsigned.ipa'] = process.argv.slice(2);
const repo = process.env.GITHUB_REPOSITORY || 'nono7444/lumio';
const size = statSync(ipa).size;
const date = new Date().toISOString();
const downloadURL = `https://github.com/${repo}/releases/download/${tag}/${ipa}`;
const iconURL = `https://raw.githubusercontent.com/${repo}/main/assets/images/icon.png`;

const source = {
  name: 'Lumio',
  identifier: 'lol.wawanono.lumio.source',
  sourceURL: `https://github.com/${repo}/releases/latest/download/altstore.json`,
  subtitle: 'Jellyfin, Radarr, Sonarr et Stremio dans ta poche',
  iconURL,
  tintColor: '#3D8BFF',
  apps: [
    {
      name: 'Lumio',
      bundleIdentifier: 'lol.wawanono.lumio',
      developerName: 'Norman',
      subtitle: 'Ton cinéma maison',
      localizedDescription:
        'Lecture Jellyfin et streaming avec mpv, ajout direct dans Radarr / Sonarr, demandes Seerr, calendrier des sorties, chat famille.',
      iconURL,
      tintColor: '#3D8BFF',
      category: 'entertainment',
      // Champs « historiques » encore lus par certains stores
      version,
      versionDate: date,
      downloadURL,
      size,
      versions: [{ version, buildVersion: version.split('.').pop(), date, size, downloadURL, minOSVersion: '16.4', localizedDescription: `Build ${tag}` }],
      appPermissions: { entitlements: [], privacy: {} },
    },
  ],
  news: [],
};

writeFileSync('altstore.json', JSON.stringify(source, null, 2));
console.log(`altstore.json : Lumio ${version} → ${downloadURL} (${size} octets)`);
