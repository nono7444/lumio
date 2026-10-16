// Notes de version (CHANGELOG.md).
//   node scripts/changelog.mjs notes             → affiche la section « À venir » (notes de la build en cours)
//   node scripts/changelog.mjs stamp 1.0.21      → renomme « À venir » en « 1.0.21 — date » et rouvre une section vide
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'CHANGELOG.md';
const HEAD = '## À venir';
const [cmd, version] = process.argv.slice(2);
const text = readFileSync(FILE, 'utf8');

function upcoming() {
  const start = text.indexOf(HEAD);
  if (start < 0) return '';
  const rest = text.slice(start + HEAD.length);
  const end = rest.search(/\n## /);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

if (cmd === 'notes') {
  process.stdout.write(upcoming());
} else if (cmd === 'stamp') {
  if (!version) throw new Error('version manquante');
  const notes = upcoming();
  if (!notes) {
    console.log('Pas de notes « À venir » : rien à tamponner');
    process.exit(0);
  }
  const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const start = text.indexOf(HEAD);
  const after = text.slice(start + HEAD.length);
  const end = after.search(/\n## /);
  const tail = end < 0 ? '' : after.slice(end);
  writeFileSync(FILE, `${text.slice(0, start)}${HEAD}\n\n## ${version} — ${date}\n\n${notes}\n${tail}`);
  console.log(`CHANGELOG : ${version} — ${date}`);
} else {
  console.error('usage : changelog.mjs notes | stamp <version>');
  process.exit(1);
}
