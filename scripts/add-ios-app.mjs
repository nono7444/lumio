// Ajoute (ou met à jour) dans la source Lumio les applis publiées par d'autres dépôts :
// - Lumio iOS (dépôt nono7444/lumio-ios) ;
// - Wawa TV, le client Twitch sans pubs (dépôt nono7444/wawa-tv) ;
// - Calisthénie, mon programme de calisthénie (dépôt nono7444/mon-programme-calisthenie).
// Usage : node scripts/add-ios-app.mjs altstore.json
// Lit la source publiée par chaque dépôt et recopie son appli : une seule source FlareStore pour tout.
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] || 'altstore.json';
const EXTERNAL = [
  {
    name: 'Lumio iOS',
    source: 'https://github.com/nono7444/lumio-ios/releases/latest/download/altstore.json',
    bundle: 'lol.wawanono.lumio.ios',
    subtitle: 'Lumio, version Nuvio',
  },
  {
    name: 'Wawa TV',
    source: 'https://github.com/nono7444/wawa-tv/releases/latest/download/altstore.json',
    bundle: 'lol.wawanono.wawatv',
    subtitle: 'Twitch sans pubs',
  },
  {
    name: 'Calisthénie',
    source: 'https://github.com/nono7444/mon-programme-calisthenie/releases/latest/download/altstore.json',
    bundle: 'lol.wawanono.calisthenie',
    subtitle: 'Mon programme de calisthénie',
  },
];

async function fetchApp(x) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(x.source, { redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const app = (await r.json()).apps?.find((a) => a.bundleIdentifier === x.bundle);
      if (app) return app;
      throw new Error('appli absente de la source');
    } catch (e) {
      console.log(`Source ${x.name} indisponible (${e.message}), nouvel essai…`);
      await new Promise((res) => setTimeout(res, 5000));
    }
  }
  return null;
}

const source = JSON.parse(readFileSync(file, 'utf8'));
source.apps = source.apps || [];
for (const x of EXTERNAL) {
  const app = await fetchApp(x);
  // Source indisponible : on garde la version déjà présente
  if (!app) {
    console.log(`${x.name} non trouvée : laissée telle quelle.`);
    continue;
  }
  app.subtitle = app.subtitle || x.subtitle;
  source.apps = source.apps.filter((a) => a.bundleIdentifier !== x.bundle);
  source.apps.push(app);
  console.log(`${file} : ${x.name} ${app.version} ajoutée`);
}
writeFileSync(file, JSON.stringify(source, null, 2));
