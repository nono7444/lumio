// Ajoute (ou met à jour) l'appli Lumio iOS (dépôt nono7444/lumio-ios) dans la source Lumio.
// Usage : node scripts/add-ios-app.mjs altstore.json
// Lit la source publiée par lumio-ios et recopie son appli : une seule source pour Lumio, Lumio Auto et Lumio iOS.
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] || 'altstore.json';
const IOS_SOURCE = 'https://github.com/nono7444/lumio-ios/releases/latest/download/altstore.json';
const BUNDLE = 'lol.wawanono.lumio.ios';

const source = JSON.parse(readFileSync(file, 'utf8'));
let app;
for (let i = 0; i < 3 && !app; i++) {
  try {
    const r = await fetch(IOS_SOURCE, { redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    app = (await r.json()).apps?.find((a) => a.bundleIdentifier === BUNDLE);
  } catch (e) {
    console.log(`Source Lumio iOS indisponible (${e.message}), nouvel essai…`);
    await new Promise((res) => setTimeout(res, 5000));
  }
}
if (!app) {
  console.log('Lumio iOS non trouvée : source inchangée.');
  process.exit(0);
}
app.subtitle = app.subtitle || 'Lumio, version Nuvio';
source.apps = (source.apps || []).filter((a) => a.bundleIdentifier !== BUNDLE);
source.apps.push(app);
writeFileSync(file, JSON.stringify(source, null, 2));
console.log(`${file} : Lumio iOS ${app.version} ajoutée`);
