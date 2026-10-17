/* Prova del pacchetto costruito da electron-builder (usata dal workflow «Pacchetti di installazione»).
   Avvia il server come fa l'app installata: l'eseguibile dell'app in modalità Node (ELECTRON_RUN_AS_NODE)
   con il server.js del pacchetto, poi controlla /api/health e una lettura dal database (better-sqlite3
   ricompilato per Electron). Su Linux controlla anche che l'AppImage porti l'icona nelle misure standard:
   i menu (e AppImageLauncher, Gear Lever…) non usano un'icona 1024×1024. Esce con codice 1 se qualcosa non va. */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const DIST = path.join(__dirname, '..', 'dist');
const NAME = 'CoverForge Studio';
const candidates = {
  linux: [['linux-unpacked', 'coverforge-studio', 'resources/app']],
  win32: [['win-unpacked', `${NAME}.exe`, 'resources/app']],
  darwin: ['mac-arm64', 'mac', 'mac-x64'].map(d => [d, `${NAME}.app/Contents/MacOS/${NAME}`, `${NAME}.app/Contents/Resources/app`])
}[process.platform] || [];

const found = candidates.map(([d, exe, app]) => ({ exe: path.join(DIST, d, exe), app: path.join(DIST, d, app) }))
  .find(c => fs.existsSync(c.exe) && fs.existsSync(path.join(c.app, 'server.js')));
if (!found) { console.error('Pacchetto non trovato in dist/:', fs.existsSync(DIST) ? fs.readdirSync(DIST) : '(manca dist)'); process.exit(1); }
console.log('Eseguibile:', found.exe);

const PORT = 3999;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverforge-smoke-'));
const proc = spawn(found.exe, [path.join(found.app, 'server.js')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT), DATA_DIR: dataDir, GUIDE_DIR: path.join(found.app, 'prompt-guide') },
  stdio: 'inherit'
});

const get = (p) => new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: p, headers: { host: `localhost:${PORT}` }, timeout: 1000 }, (res) => {
    let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, body: b }));
  });
  req.on('error', () => resolve(null)); req.on('timeout', () => { req.destroy(); resolve(null); });
});

(async () => {
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) {
    const r = await get('/api/health');
    ok = r?.status === 200 && JSON.parse(r.body).ok === true;
    if (!ok) await new Promise(r => setTimeout(r, 500));
  }
  const checks = ok ? await Promise.all(['/api/history', '/api/style-profile', '/api/prompt-guide', '/'].map(get)) : [];
  proc.kill();
  if (!ok) { console.error('✖ Il server del pacchetto non risponde su /api/health.'); process.exit(1); }
  const bad = checks.map((r, i) => [['/api/history', '/api/style-profile', '/api/prompt-guide', '/'][i], r?.status]).filter(([, s]) => s !== 200);
  if (bad.length) { console.error('✖ Risposte inattese:', bad); process.exit(1); }
  console.log('✔ Il server del pacchetto risponde; database, profilo, guida e interfaccia funzionano.');
  if (process.platform === 'linux') checkLinuxIcons();
})();

function checkLinuxIcons() {
  const img = fs.readdirSync(DIST).find(f => f.endsWith('.AppImage'));
  if (!img) { console.error('✖ AppImage non trovata in dist/.'); process.exit(1); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coverforge-appimage-'));
  const r = spawnSync(path.join(DIST, img), ['--appimage-extract'], { cwd: tmp, stdio: 'ignore' });
  const root = path.join(tmp, 'squashfs-root');
  if (r.status !== 0 || !fs.existsSync(root)) { console.error('✖ Estrazione dell\'AppImage non riuscita.'); process.exit(1); }
  const desktop = fs.readFileSync(path.join(root, 'coverforge-studio.desktop'), 'utf8');
  const icon = (desktop.match(/^Icon=(.+)$/m) || [])[1];
  const missing = [48, 128, 256].filter(s => !fs.existsSync(path.join(root, `usr/share/icons/hicolor/${s}x${s}/apps/${icon}.png`)));
  if (!icon || missing.length) { console.error('✖ Icona Linux mancante nelle misure:', missing.join(', ') || '(Icon= assente)'); process.exit(1); }
  if (!/^StartupWMClass=coverforge-studio$/m.test(desktop)) { console.error('✖ StartupWMClass non corrisponde all\'app_id della finestra.'); process.exit(1); }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('✔ AppImage: icona in 48, 128 e 256 px e finestra collegata al lanciatore.');
}
