#!/usr/bin/env node
/* CoverForge Studio: avvio dai sorgenti, uguale su Windows, macOS e Linux.
   Controlla Node, installa le dipendenze la prima volta, avvia il server (o riusa quello già attivo)
   e apre il browser. Ctrl+C (o la chiusura della finestra del terminale) ferma il server.
   Lo usano CoverForge.cmd (Windows), CoverForge.command (macOS) e `npm run web`. */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const DIR = __dirname;
const WIN = process.platform === 'win32';

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

/* Node 20.3 o successivo (AbortSignal.any, usato dal server) */
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 20 || (maj === 20 && min < 3)) fail(`Serve Node.js 20.3 o successivo (hai ${process.versions.node}). Scaricalo da https://nodejs.org`);

/* Prima volta: dipendenze */
if (!fs.existsSync(path.join(DIR, 'node_modules', 'better-sqlite3'))) {
  console.log('Prima installazione: scarico le dipendenze (serve un minuto, solo la prima volta)…');
  const r = spawnSync(WIN ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: DIR, stdio: 'inherit', shell: WIN });
  if (r.status !== 0) fail('Installazione delle dipendenze non riuscita: controlla la connessione e riprova.');
}

/* Porta: variabile d'ambiente, altrimenti la riga PORT di .env, altrimenti 3000 (come server.js) */
function readPort() {
  let p = Number(process.env.PORT);
  if (!p) {
    try { p = Number(require('dotenv').parse(fs.readFileSync(path.join(DIR, '.env'))).PORT); } catch { p = 0; }
  }
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : 3000;
}
const PORT = readPort();
const URL = `http://localhost:${PORT}`;

/* true solo se sulla porta risponde davvero CoverForge */
function health() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', timeout: 700 }, (res) => {
      let body = '';
      res.on('data', (d) => { if (body.length < 2000) body += d; });
      res.on('end', () => { try { resolve(res.statusCode === 200 && JSON.parse(body).ok === true); } catch { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function openBrowser() {
  if (process.env.COVERFORGE_NO_BROWSER) return console.log(`Apri ${URL} nel browser.`);
  // su Windows «start» vuole un titolo (anche vuoto) prima dell'indirizzo; Node passa '' come ""
  const [cmd, args] = WIN ? ['cmd', ['/c', 'start', '', URL]]
    : process.platform === 'darwin' ? ['open', [URL]] : ['xdg-open', [URL]];
  const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
  p.on('error', () => console.log(`Apri ${URL} nel browser.`));
  p.unref();
}

(async () => {
  if (await health()) {
    console.log(`CoverForge Studio è già in esecuzione su ${URL}.`);
    openBrowser();
    return;
  }
  console.log('Avvio di CoverForge Studio…');
  const server = spawn(process.execPath, [path.join(DIR, 'server.js')], { cwd: DIR, stdio: 'inherit', env: { ...process.env, PORT: String(PORT) } });
  let exited = false;
  server.on('exit', (code) => { exited = true; process.exit(code ?? 0); });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => server.kill('SIGTERM'));

  const t0 = Date.now();
  while (!exited && Date.now() - t0 < 40000) {
    if (await health()) {
      console.log(`\nPronto: ${URL}\nTieni aperta questa finestra; per chiudere CoverForge premi Ctrl+C o chiudila.\n`);
      openBrowser();
      return;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!exited) { server.kill('SIGTERM'); fail('Il server non ha risposto entro 40 secondi.'); }
})();
