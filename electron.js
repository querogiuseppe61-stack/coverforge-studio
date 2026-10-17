const { app, BrowserWindow, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const LOG_PATH = path.join(__dirname, 'coverforge.log');

/* Porta: variabile d'ambiente, altrimenti la riga PORT di .env (si legge solo quella), altrimenti 3000 */
function readPort() {
  let p = Number(process.env.PORT);
  if (!p) {
    try { p = Number(require('dotenv').parse(fs.readFileSync(path.join(__dirname, '.env'))).PORT); } catch { p = 0; }
  }
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : 3000;
}
const PORT = readPort();
const ORIGIN = `http://localhost:${PORT}`;                 // stessa origine di sempre: il localStorage resta quello
const LOCAL_UI = pathToFileURL(path.join(__dirname, 'public')).href;

let win = null;
let serverProc = null;
let serverExit = null;       // { at, code, signal } oppure { at, error }

/* ── Server ──
   Si avvia con il `node` vero: process.execPath è il binario di Electron, che non carica i moduli
   nativi (better-sqlite3) compilati per Node. Se un server CoverForge è già attivo sulla porta
   (es. avviato con coverforge.sh --web) lo si riutilizza e alla chiusura non lo si ferma. */
function openServerLog() {
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 1024 * 1024) fs.renameSync(LOG_PATH, LOG_PATH + '.1');
    const fd = fs.openSync(LOG_PATH, 'a');
    fs.writeSync(fd, `── ${new Date().toISOString()} avvio (Electron) ──\n`);
    return fd;
  } catch { return 'inherit'; }   // log non scrivibile: l'output resta nel terminale
}

function startServer() {
  serverExit = null;
  const nodeBin = process.env.npm_node_execpath || 'node';
  const log = openServerLog();
  const proc = spawn(nodeBin, [path.join(__dirname, 'server.js')], {
    stdio: log === 'inherit' ? 'inherit' : ['ignore', log, log],
    env: { ...process.env, PORT: String(PORT) }
  });
  if (log !== 'inherit') fs.closeSync(log);   // il processo figlio ha la sua copia del descrittore
  serverProc = proc;
  proc.on('error', (err) => { serverExit = { at: Date.now(), error: err.message }; if (serverProc === proc) serverProc = null; });
  proc.on('exit', (code, signal) => { serverExit = { at: Date.now(), code, signal }; if (serverProc === proc) serverProc = null; });
}

function stopServer() {
  if (serverProc && !serverProc.killed) serverProc.kill('SIGTERM');   // il server chiude DB e connessioni
  serverProc = null;
}

/* true solo se sulla porta risponde davvero CoverForge (non un altro programma che dà 200 a tutto) */
function checkHealth() {
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

async function waitForServer(maxMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await checkHealth()) return true;
    // il processo figlio è già uscito (porta occupata, errore all'avvio): si rinuncia senza aspettare 40 s
    if (serverExit && Date.now() - serverExit.at > 1500) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/* ── Finestra ── */
const LOADING_HTML = `<!doctype html><html lang="it"><meta charset="utf-8"><title>CoverForge Studio</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b0f1a;color:#c8d0e8;font:16px system-ui,sans-serif">
<div style="text-align:center"><div style="width:34px;height:34px;margin:0 auto 18px;border:3px solid #2a3350;border-top-color:#7c5cff;border-radius:50%;animation:s 1s linear infinite"></div>
Avvio di CoverForge Studio…</div><style>@keyframes s{to{transform:rotate(360deg)}}</style></body></html>`;

function openExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.toString());
  } catch { /* URL non valido: ignorato */ }
}

const isAppUrl = (url) => url === ORIGIN || url.startsWith(ORIGIN + '/') || url.startsWith(LOCAL_UI);

function hardenSession() {
  // l'app non usa fotocamera, posizione, notifiche ecc.: ogni richiesta di permesso viene negata
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    backgroundColor: '#0b0f1a',
    title: 'CoverForge Studio',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false
    }
  });
  const w = win;
  w.once('ready-to-show', () => w.show());
  setTimeout(() => { if (!w.isDestroyed() && !w.isVisible()) w.show(); }, 2500);   // rete di sicurezza

  // la finestra non deve mai diventare un browser: link esterni al sistema, nuove finestre negate
  w.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, url) => { if (!isAppUrl(url)) { e.preventDefault(); openExternal(url); } });
  w.webContents.on('will-attach-webview', (e) => e.preventDefault());
  w.on('closed', () => { if (win === w) win = null; });
}

const logTail = (lines = 8) => {
  try { return fs.readFileSync(LOG_PATH, 'utf8').trim().split('\n').slice(-lines).join('\n'); } catch { return '(log non disponibile)'; }
};

async function askRecovery() {
  const why = serverExit?.error ? `Impossibile avviare Node: ${serverExit.error}`
    : serverExit ? `Il server si è fermato (codice ${serverExit.code ?? serverExit.signal}).`
    : 'Il server non ha risposto entro 40 secondi.';
  const { response } = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
    type: 'error', title: 'CoverForge Studio', noLink: true,
    message: 'Il server di CoverForge non è partito',
    detail: `${why}\n\nCause tipiche: la porta ${PORT} è occupata da un altro programma (cambia PORT in .env), `
      + `Node.js non è installato o è troppo vecchio (serve 20.3 o successivo).\n\nUltime righe del log:\n${logTail()}`,
    buttons: ['Riprova', 'Apri il log', 'Modalità diretta (limitata)', 'Esci'],
    defaultId: 0, cancelId: 3
  });
  return ['retry', 'log', 'direct', 'quit'][response];
}

async function boot() {
  const show = () => { if (win && !win.isDestroyed()) win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_HTML)); };
  show();
  if (!(await checkHealth())) startServer();
  for (;;) {
    if (await waitForServer()) {
      if (win && !win.isDestroyed()) win.loadURL(ORIGIN);
      return;
    }
    const choice = await askRecovery();
    if (choice === 'retry') { stopServer(); startServer(); show(); continue; }
    if (choice === 'log') { await shell.openPath(LOG_PATH); continue; }
    if (choice === 'direct') {
      // senza server mancano cronologia e riferimenti; si usa la chiave scritta nell'interfaccia
      if (win && !win.isDestroyed()) win.loadFile(path.join(__dirname, 'public', 'index.html'));
      return;
    }
    app.quit();
    return;
  }
}

/* ── Ciclo di vita ── */
if (!app.requestSingleInstanceLock()) {
  app.quit();   // una seconda copia non deve avviare un altro server sulla stessa porta
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    hardenSession();
    createWindow();
    boot();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { createWindow(); boot(); } });
  });
  app.on('window-all-closed', () => {
    stopServer();
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', stopServer);
}
