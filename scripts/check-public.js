/* Controllo di sintassi degli script dell'interfaccia (public/*.js e public/js/*.js), usato da `npm run check`.
   Controlla anche che index.html carichi ogni script di public/js/ e nessuno che non esista. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const files = [
  ...fs.readdirSync(PUB).filter((f) => f.endsWith('.js')),
  ...fs.readdirSync(path.join(PUB, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f)
];
for (const f of files) execFileSync(process.execPath, ['--check', path.join(PUB, f)], { stdio: 'inherit' });

const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const loaded = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const missing = files.filter((f) => !loaded.includes(f));
const unknown = loaded.filter((f) => !files.includes(f));
if (missing.length || unknown.length) {
  console.error('index.html non allineato:', { 'script non caricati': missing, 'script inesistenti': unknown });
  process.exit(1);
}
console.log(`✔ ${files.length} script dell'interfaccia: sintassi corretta, tutti caricati da index.html.`);
