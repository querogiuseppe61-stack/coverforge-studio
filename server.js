require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const multer = require('multer');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1';
const ALLOWED_ORIGINS = [`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`];

/* Cartella dei dati (database, upload, immagini generate). Di default è la cartella del progetto;
   con DATA_DIR nel .env si può spostare altrove, ad esempio ~/.local/share/coverforge. */
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');

/* Solo richieste locali: blocca DNS rebinding (Host) e richieste cross-site (Origin) */
app.use((req, res, next) => {
  if (!ALLOWED_ORIGINS.includes(req.headers.host)) {
    return res.status(403).json({ error: 'Host non consentito.' });
  }
  const origin = req.headers.origin;
  if (origin && req.method !== 'GET' && req.method !== 'HEAD'
      && !ALLOWED_ORIGINS.some(h => origin === `http://${h}`)) {
    return res.status(403).json({ error: 'Origine non consentita.' });
  }
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

/* Solo le rotte che ricevono immagini in base64 accettano corpi grandi */
app.use(['/api/generate', '/api/history'], express.json({ limit: '30mb' }));
app.use('/api/craft', express.json({ limit: '8mb' }));   // testo + fino a 3 immagini ridotte
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ── SQLite ── */
const db = new Database(path.join(DATA_DIR, 'coverforge.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    category TEXT NOT NULL,
    ratio TEXT,
    style TEXT,
    title TEXT,
    subtitle TEXT,
    brief TEXT,
    prompt TEXT,
    image TEXT,
    text_model TEXT,
    image_model TEXT
  );
`);
/* Le nuove immagini stanno su disco (generated/), in DB solo il nome file.
   Le righe vecchie con base64 in `image` restano valide e vengono lette com'erano. */
if (!db.prepare('PRAGMA table_info(history)').all().some(c => c.name === 'image_file')) {
  db.exec('ALTER TABLE history ADD COLUMN image_file TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_history_ts ON history(ts)');
db.exec(`
  CREATE TABLE IF NOT EXISTS reference_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER,
    extracted_text TEXT,
    ts INTEGER NOT NULL
  );
`);

/* ── File upload ── */
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const GENERATED_DIR = path.join(DATA_DIR, 'generated');
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
const HISTORY_MAX = 500;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, crypto.randomUUID() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      '.txt', '.md', '.docx', '.pdf',
      '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    const err = new Error(`Tipo file non supportato: ${ext || '(senza estensione)'}. Accettati: ${allowed.join(', ')}`);
    err.status = 400;
    cb(err);
  }
});

/* ── Text extraction helpers ──
   Oltre MAX_EXTRACT_BYTES il file viene archiviato ma non analizzato; ogni estrazione ha un tempo massimo. */
const MAX_EXTRACT_BYTES = 25 * 1024 * 1024;
const MAX_STORED_TEXT = 500000;   // caratteri conservati per file (un romanzo intero ne ha 500-900 mila)
const EXTRACT_TIMEOUT_MS = 30000;

function withTimeout(promise, ms, label) {
  let t;
  const timer = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${label}: tempo scaduto`)), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.txt' || ext === '.md') {
    return await fs.promises.readFile(filePath, 'utf-8');
  }
  if (ext !== '.pdf' && ext !== '.docx') return '';
  try {
    const { size } = await fs.promises.stat(filePath);
    if (size > MAX_EXTRACT_BYTES) {
      console.error(`Estrazione saltata (${Math.round(size / 1048576)} MB > ${MAX_EXTRACT_BYTES / 1048576} MB): ${path.basename(filePath)}`);
      return '';
    }
    const buf = await fs.promises.readFile(filePath);
    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await withTimeout(mammoth.extractRawText({ buffer: buf }), EXTRACT_TIMEOUT_MS, 'DOCX');
      return result.value || '';
    }
    const { PDFParse } = require('pdf-parse');   // API 2.x: classe, non funzione
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const result = await withTimeout(parser.getText(), EXTRACT_TIMEOUT_MS, 'PDF');
      return result.text || '';
    } finally {
      await parser.destroy().catch(() => {});
    }
  } catch (e) {
    console.error(`Estrazione ${ext.slice(1).toUpperCase()} fallita:`, e.message);
    return '';
  }
}

/* Controlla che l'inizio del file corrisponda all'estensione dichiarata */
async function sniffFile(filePath, ext) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(4096), 0, 4096, 0);
    const b = buffer.subarray(0, bytesRead);
    if (!b.length) return false;
    const starts = (...bytes) => bytes.every((v, i) => b[i] === v);
    switch (ext) {
      case '.png':  return starts(0x89, 0x50, 0x4e, 0x47);
      case '.jpg': case '.jpeg': return starts(0xff, 0xd8, 0xff);
      case '.gif':  return starts(0x47, 0x49, 0x46, 0x38);
      case '.bmp':  return starts(0x42, 0x4d);
      case '.webp': return b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
      case '.pdf':  return b.toString('latin1').includes('%PDF');      // l'intestazione può non essere al byte 0
      case '.docx': return starts(0x50, 0x4b, 0x03, 0x04);              // contenitore zip
      case '.txt': case '.md': return !b.includes(0);                   // testo: nessun byte nullo (esclude binari e UTF-16)
      default: return false;
    }
  } finally {
    await fh.close();
  }
}

/* ── API: Reference files ── */
app.get('/api/ref-files', (_req, res) => {
  const rows = db.prepare('SELECT id, original_name, stored_name, file_type, mime_type, size, ts FROM reference_files ORDER BY ts DESC').all();
  res.json(rows);
});

/* Estratto di un testo lungo: metà dal principio, un quarto dal centro, un quarto dalla fine,
   così il modello vede l'impianto dell'opera e non solo le prime pagine. */
function sampleText(text, limit) {
  if (text.length <= limit) return { text, sampled: false };
  const head = Math.floor(limit * 0.5), mid = Math.floor(limit * 0.25), tail = limit - head - mid;
  const m0 = Math.floor((text.length - mid) / 2);
  const cut = '\n[… passaggio omesso …]\n';
  return { text: text.slice(0, head) + cut + text.slice(m0, m0 + mid) + cut + text.slice(text.length - tail), sampled: true };
}

app.get('/api/ref-files/:id/text', (req, res) => {
  const row = db.prepare('SELECT original_name, extracted_text FROM reference_files WHERE id=?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'File non trovato.' });
  const full = row.extracted_text || '';
  const limit = Math.min(60000, Math.max(500, Math.round(Number(req.query.limit)) || 4000));
  const { text, sampled } = sampleText(full, limit);
  res.json({ name: row.original_name, text, sampled, total: full.length });
});

app.post('/api/ref-files/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nessun file caricato.' });
    const { originalname, filename, mimetype, size } = req.file;
    const ext = path.extname(originalname).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext);
    const fileType = isImage ? 'image' : ext.slice(1); // txt, pdf, docx, md

    if (!(await sniffFile(path.join(UPLOAD_DIR, filename), ext))) {
      await fs.promises.unlink(path.join(UPLOAD_DIR, filename)).catch(() => {});
      const hint = ext === '.txt' || ext === '.md' ? ' (se è un testo, salvalo come UTF-8)' : '';
      return res.status(400).json({ error: `Il contenuto del file non corrisponde al tipo "${ext}"${hint}.` });
    }

    let extractedText = null;
    if (!isImage) {
      extractedText = await extractText(path.join(UPLOAD_DIR, filename));
      // Truncate very long text
      if (extractedText && extractedText.length > MAX_STORED_TEXT) extractedText = extractedText.slice(0, MAX_STORED_TEXT);
    }

    const info = db.prepare(
      'INSERT INTO reference_files (original_name, stored_name, file_type, mime_type, size, extracted_text, ts) VALUES (?,?,?,?,?,?,?)'
    ).run(originalname, filename, fileType, mimetype, size, extractedText, Date.now());

    res.json({
      id: info.lastInsertRowid, original_name: originalname, stored_name: filename, file_type: fileType,
      text_extracted: isImage ? null : Boolean(extractedText && extractedText.trim())
    });
  } catch (e) {
    // il file è già su disco ma non è stato registrato: non lasciarlo orfano
    if (req.file) fs.promises.unlink(path.join(UPLOAD_DIR, req.file.filename)).catch(() => {});
    console.error('upload:', e);
    res.status(500).json({ error: 'Caricamento fallito: impossibile elaborare il file.' });
  }
});

const unlinkQuiet = (name) => fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(name))).catch((e) => { if (e.code !== 'ENOENT') throw e; });

app.delete('/api/ref-files/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT stored_name FROM reference_files WHERE id=?').get(id);
    if (row) {
      await unlinkQuiet(row.stored_name);
      db.prepare('DELETE FROM reference_files WHERE id=?').run(id);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.delete('/api/ref-files', async (_req, res, next) => {
  try {
    const rows = db.prepare('SELECT stored_name FROM reference_files').all();
    await Promise.all(rows.map(r => unlinkQuiet(r.stored_name)));
    db.prepare('DELETE FROM reference_files').run();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ── Serve uploaded files ── */
app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders: (res, filePath) => {
    if (!IMAGE_MIME[path.extname(filePath).toLowerCase()]) res.setHeader('Content-Disposition', 'attachment');
  }
}));

/* ── OpenRouter ── */
const OR = 'https://openrouter.ai/api/v1';
const SERVER_KEY = process.env.OPENROUTER_API_KEY || '';
const hdrs = (clientKey) => ({
  'Authorization': `Bearer ${clientKey || SERVER_KEY}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
  'X-Title': 'CoverForge Studio'
});

/* La lista dei modelli dipende dalla chiave usata: una cache per chiave (solo un hash in memoria) */
const modelCache = new Map();   // hash chiave → { data, at }
const keyId = (k) => crypto.createHash('sha256').update(k || SERVER_KEY || '').digest('hex').slice(0, 16);

/* ── Chiamate a OpenRouter: timeout, retry, annullamento ──
   - timeout per tipo di richiesta (la generazione immagini è lenta)
   - retry con attesa crescente su errori di rete e su 429 (rispetta Retry-After);
     i 502/503/504 si ritentano solo dove la richiesta non costa (retry5xx)
   - se il browser chiude la richiesta (pulsante Annulla) si interrompe anche quella verso OpenRouter */
class UpstreamError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function retryDelay(r, attempt) {
  const ra = Number(r?.headers.get('retry-after'));
  const ms = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt;
  return Math.min(ms, 8000);
}

function upstreamMessage(status, j) {
  const detail = j?.error?.message ? ` (${String(j.error.message).slice(0, 200)})` : '';
  if (status === 401 || status === 403) return `Chiave API OpenRouter non valida o non autorizzata${detail}`;
  if (status === 402) return `Crediti OpenRouter esauriti${detail}`;
  if (status === 429) return 'Troppe richieste a OpenRouter: riprova fra qualche secondo.';
  return j?.error?.message ? String(j.error.message).slice(0, 300) : `Errore OpenRouter (HTTP ${status}).`;
}

async function openrouter(res, route, { method = 'POST', body, key, timeout, retries = 2, retry5xx = true, needKey = true }) {
  if (needKey && !(key || SERVER_KEY)) {
    throw new UpstreamError(401, 'Nessuna chiave API: inseriscila nelle impostazioni oppure in .env.');
  }
  const ac = new AbortController();
  const onClose = () => { if (!res.writableFinished) ac.abort(); };
  res.on('close', onClose);
  try {
    for (let attempt = 0; ; attempt++) {
      let r;
      try {
        r = await fetch(`${OR}${route}`, {
          method, headers: hdrs(key), body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.any([ac.signal, AbortSignal.timeout(timeout)])
        });
      } catch (e) {
        if (ac.signal.aborted) throw new UpstreamError(499, 'Richiesta annullata.');
        if (e.name === 'TimeoutError') throw new UpstreamError(504, `OpenRouter non ha risposto entro ${Math.round(timeout / 1000)} secondi.`);
        if (attempt < retries) { await sleep(retryDelay(null, attempt)); if (ac.signal.aborted) throw new UpstreamError(499, 'Richiesta annullata.'); continue; }
        throw new UpstreamError(502, 'Impossibile raggiungere OpenRouter: controlla la connessione.');
      }
      if (attempt < retries && (r.status === 429 || (retry5xx && r.status >= 502 && r.status <= 504))) {
        const wait = retryDelay(r, attempt);
        await r.body?.cancel().catch(() => {});
        await sleep(wait);
        if (ac.signal.aborted) throw new UpstreamError(499, 'Richiesta annullata.');
        continue;
      }
      const j = await r.json().catch(() => null);   // un proxy o un 502 possono rispondere con HTML
      if (!r.ok) throw new UpstreamError(r.status >= 500 ? 502 : r.status, upstreamMessage(r.status, j));
      if (!j) throw new UpstreamError(502, 'Risposta di OpenRouter non valida.');
      return j;
    }
  } finally {
    res.off('close', onClose);
  }
}

function sendError(res, e) {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  if (e instanceof UpstreamError) return res.status(e.status).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: 'Errore interno del server.' });
}

/* ── Prompt Master skill (estrae solo le sezioni immagini) ── */
const SKILL_DIR = path.join(__dirname, 'prompt-master-main');
let pmCache = null;

function extractSection(md, startMarker, endMarker) {
  const start = md.indexOf(startMarker);
  if (start === -1) return '';
  const end = endMarker ? md.indexOf(endMarker, start) : -1;
  return md.slice(start, end > start ? end : undefined).trim();
}

app.get('/api/prompt-master', (_req, res) => {
  try {
    if (pmCache) return res.json(pmCache);
    let out = '';
    const skillPath = path.join(SKILL_DIR, 'SKILL.md');
    const templatesPath = path.join(SKILL_DIR, 'references', 'templates.md');
    if (fs.existsSync(skillPath)) {
      const skill = fs.readFileSync(skillPath, 'utf-8');
      // Sezioni immagini da SKILL.md
      out += extractSection(skill, '**Image AI — Generation**', '**Image AI — Reference Editing**') + '\n\n';
      out += extractSection(skill, '**Image AI — Reference Editing**', '**ComfyUI**') + '\n\n';
    }
    if (fs.existsSync(templatesPath)) {
      const templates = fs.readFileSync(templatesPath, 'utf-8');
      // Template I (Visual Descriptor) e Template J (Reference Editing)
      out += extractSection(templates, '## Template I — Visual Descriptor', '## Template J') + '\n\n';
      out += extractSection(templates, '## Template J — Reference Image Editing', '## Template K') + '\n\n';
    }
    if (!out.trim()) {
      return res.status(404).json({ error: 'Skill prompt-master non trovata in prompt-master-main/' });
    }
    pmCache = { content: out };
    res.json(pmCache);
  } catch (e) { sendError(res, e); }
});

/* Guida ai prompt (prompt-guide/cover-forge.md): sezioni "## nome", rilette quando il file cambia */
const GUIDE_FILE = path.join(__dirname, 'prompt-guide', 'cover-forge.md');
let guideCache = null;
app.get('/api/prompt-guide', async (_req, res, next) => {
  try {
    const st = await fs.promises.stat(GUIDE_FILE).catch(() => null);
    if (!st) return res.status(404).json({ error: 'Guida non trovata (prompt-guide/cover-forge.md).' });
    if (!guideCache || guideCache.mtime !== st.mtimeMs) {
      const md = await fs.promises.readFile(GUIDE_FILE, 'utf-8');
      const sections = {};
      md.split(/^## /m).slice(1).forEach((block) => {
        const nl = block.indexOf('\n');
        sections[block.slice(0, nl).trim().toLowerCase()] = block.slice(nl + 1).trim();
      });
      guideCache = { mtime: st.mtimeMs, sections };
    }
    res.json({ sections: guideCache.sections });
  } catch (e) { next(e); }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, hasServerKey: !!SERVER_KEY }));

/* Verifica connessione: 1) OpenRouter è raggiungibile? 2) la chiave è valida, e quanto credito resta?
   Risponde sempre 200 con l'esito di ogni passo: un controllo fallito non è un errore del server.
   La chiave non viene mai restituita. */
app.get('/api/check', async (req, res) => {
  const clientKey = req.headers['x-or-key'] || '';
  const key = clientKey || SERVER_KEY;
  const result = { ok: false, keySource: clientKey ? 'interfaccia' : SERVER_KEY ? 'server' : 'nessuna', steps: [] };
  const step = (id, ok, detail, extra) => result.steps.push({ id, ok, detail, ...extra });
  try {
    // 1) raggiungibilità: l'elenco dei modelli è pubblico
    const t0 = Date.now();
    try {
      const j = await openrouter(res, '/models', { method: 'GET', key, timeout: 10000, retries: 0, needKey: false });
      const n = Array.isArray(j.data) ? j.data.length : 0;
      step('rete', true, `OpenRouter raggiungibile (${Date.now() - t0} ms, ${n} modelli disponibili).`, { ms: Date.now() - t0 });
    } catch (e) {
      if (e.status === 499) throw e;
      step('rete', false, e.message);
      return res.json(result);
    }

    // 2) chiave
    if (!key) {
      step('chiave', false, 'Nessuna chiave: scrivila nel campo qui sopra oppure in .env (OPENROUTER_API_KEY).');
      return res.json(result);
    }
    let info = null, lastErr = null;
    for (const route of ['/key', '/auth/key']) {   // il nome dell'endpoint è cambiato nel tempo
      try { info = await openrouter(res, route, { method: 'GET', key, timeout: 10000, retries: 0 }); break; }
      catch (e) { lastErr = e; if (e.status !== 404) break; }
    }
    if (!info) {
      const bad = lastErr && (lastErr.status === 401 || lastErr.status === 403);
      step('chiave', false, bad ? `Chiave non valida o revocata (${result.keySource === 'server' ? 'quella in .env' : 'quella nel campo'}).` : `Controllo della chiave non riuscito: ${lastErr.message}`);
      return res.json(result);
    }
    const d = info.data || info;
    const num = (v) => (typeof v === 'number' ? v : null);
    // /key descrive solo la CHIAVE (limite di spesa proprio, spesa fatta con quella chiave): non è il saldo del conto.
    // Il saldo del conto sta in /credits, che OpenRouter concede solo alle management key (con le altre risponde 403).
    let account = null;
    try {
      const c = await openrouter(res, '/credits', { method: 'GET', key, timeout: 10000, retries: 0 });
      const cd = c.data || c;
      if (num(cd.total_credits) !== null && num(cd.total_usage) !== null) {
        account = { total: cd.total_credits, usage: cd.total_usage, remaining: cd.total_credits - cd.total_usage };
      }
    } catch (e) {
      if (e.status === 499) throw e;              // annullato dal browser
      // 401/403/404 o rete: il saldo non è leggibile, si mostrano solo i dati della chiave
    }
    const credit = {
      account,                                    // { total, usage, remaining } oppure null
      keyLimit: num(d.limit),                     // null = nessun limite impostato sulla chiave
      keyLimitRemaining: num(d.limit_remaining),
      keyUsage: num(d.usage),
      free: d.is_free_tier === true
    };
    const where = result.keySource === 'server' ? 'quella in .env' : 'quella nel campo';
    step('chiave', true, `Chiave valida (${where}).`, { credit });
    result.ok = true;
    res.json(result);
  } catch (e) { sendError(res, e); }
});

app.get('/api/models', async (req, res) => {
  try {
    const cid = keyId(req.headers['x-or-key']);
    const hit = modelCache.get(cid);
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) return res.json(hit.data);
    const j = await openrouter(res, '/models', { method: 'GET', key: req.headers['x-or-key'], timeout: 20000, needKey: false });
    const list = Array.isArray(j.data) ? j.data : [];
    const text = [], image = [];
    for (const m of list) {
      const out = m.architecture?.output_modalities || [];
      const inn = m.architecture?.input_modalities || [];
      const entry = { id: m.id, name: m.name, vision: inn.includes('image') };
      if (out.includes('image')) image.push(entry);
      if (out.includes('text')) text.push(entry);
    }
    const data = { text, image };
    if (modelCache.size >= 20) modelCache.delete(modelCache.keys().next().value);
    modelCache.set(cid, { data, at: Date.now() });
    res.json(data);
  } catch (e) { sendError(res, e); }
});

/* Messaggi per il modello di testo: ruoli noti, testo oppure parti testo/immagine.
   Le immagini devono essere già incorporate (data URL raster): niente URL arbitrari. */
function sanitizeMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 12) throw new UpstreamError(400, 'Messaggi non validi.');
  let images = 0;
  return messages.map((m) => {
    if (!m || !['system', 'user', 'assistant'].includes(m.role)) throw new UpstreamError(400, 'Messaggio con ruolo non valido.');
    if (typeof m.content === 'string') return { role: m.role, content: m.content.slice(0, 300000) };
    if (!Array.isArray(m.content) || m.content.length > 8 || m.role !== 'user') throw new UpstreamError(400, 'Contenuto del messaggio non valido.');
    return {
      role: m.role,
      content: m.content.map((p) => {
        if (p?.type === 'text' && typeof p.text === 'string') return { type: 'text', text: p.text.slice(0, 300000) };
        const url = p?.type === 'image_url' ? p.image_url?.url : null;
        if (typeof url === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(url.slice(0, 40)) && url.length <= 3000000 && ++images <= 3) {
          return { type: 'image_url', image_url: { url } };
        }
        throw new UpstreamError(400, 'Immagine non valida o troppe immagini (massimo 3).');
      })
    };
  });
}

app.post('/api/craft', async (req, res) => {
  const { model } = req.body;
  const key = req.headers['x-or-key'] || req.body.key;
  try {
    const messages = sanitizeMessages(req.body.messages);
    const j = await openrouter(res, '/chat/completions', {
      key, timeout: 90000, retries: 2,
      body: { model, messages, temperature: 0.9 }
    });
    res.json({ content: j.choices?.[0]?.message?.content || '' });
  } catch (e) { sendError(res, e); }
});

const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp'
};

/* Le immagini caricate (/uploads/…) vengono lette dal disco e inviate come data URL:
   OpenRouter non può raggiungere i percorsi locali. Sono ammessi solo file registrati nel DB. */
async function resolveReferenceImage(url) {
  if (typeof url !== 'string') throw new Error('Riferimento immagine non valido.');
  if (url.startsWith('/uploads/')) {
    const name = path.basename(url.slice('/uploads/'.length));
    const row = db.prepare("SELECT stored_name FROM reference_files WHERE stored_name=? AND file_type='image'").get(name);
    if (!row) throw new Error('Immagine di riferimento non trovata (rimossa?).');
    const buf = await fs.promises.readFile(path.join(UPLOAD_DIR, row.stored_name))
      .catch(() => { throw new Error('Immagine di riferimento non leggibile (file mancante?).'); });
    const mime = IMAGE_MIME[path.extname(row.stored_name).toLowerCase()] || 'application/octet-stream';
    return `data:${mime};base64,${buf.toString('base64')}`;
  }
  const h = /^\/api\/history\/(\d+)\/image$/.exec(url);   // immagine della cronologia (es. "Rifinisci")
  if (h) {
    const img = await readHistoryImage(Number(h[1]));
    if (!img) throw new Error('Immagine della cronologia non trovata.');
    return img.url || `data:${img.mime};base64,${img.buf.toString('base64')}`;
  }
  if (url.startsWith('data:image/') || url.startsWith('https://')) return url;
  throw new Error('Riferimento immagine non consentito.');
}

app.post('/api/generate', async (req, res) => {
  const { model, prompt, referenceImages = [] } = req.body;
  const key = req.headers['x-or-key'] || req.body.key;
  let resolved;
  try {
    if (!Array.isArray(referenceImages)) throw new Error('referenceImages deve essere un elenco.');
    resolved = await Promise.all(referenceImages.map(resolveReferenceImage));
  } catch (e) { return res.status(400).json({ error: e.message }); }
  const content = [
    ...resolved.map(url => ({ type: 'image_url', image_url: { url } })),
    { type: 'text', text: prompt }
  ];
  try {
    // la generazione costa: un solo nuovo tentativo, e solo su 429 o errore di rete (mai su 5xx o timeout)
    const j = await openrouter(res, '/chat/completions', {
      key, timeout: 180000, retries: 1, retry5xx: false,
      body: { model, messages: [{ role: 'user', content }], modalities: ['image', 'text'] }
    });
    const msg = j.choices?.[0]?.message || {};
    const imgs = (msg.images || []).map(i => i.image_url?.url).filter(Boolean);
    if (!imgs.length) return res.status(422).json({ error: 'Il modello non ha restituito immagini.', text: msg.content });
    res.json({ images: imgs, note: msg.content || '' });
  } catch (e) { sendError(res, e); }
});

/* ── Cronologia ── */
const HISTORY_CATEGORIES = ['libro', 'album', 'logo', 'icona', 'header'];
const EXT_FOR_MIME = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp' };
const clip = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/* Intestazione attesa per ciascun formato raster */
function imageSignatureOk(buf, mime) {
  const at = (i, ...bytes) => bytes.every((v, k) => buf[i + k] === v);
  switch (mime) {
    case 'image/png':  return at(0, 0x89, 0x50, 0x4e, 0x47);
    case 'image/jpeg': return at(0, 0xff, 0xd8, 0xff);
    case 'image/gif':  return at(0, 0x47, 0x49, 0x46, 0x38);
    case 'image/bmp':  return at(0, 0x42, 0x4d);
    case 'image/webp': return buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
    default: return false;
  }
}

/* Solo formati raster noti (niente SVG: potrebbe contenere script) e con l'intestazione giusta */
function parseImageDataUrl(s) {
  const m = /^data:(image\/(?:png|jpeg|webp|gif|bmp));base64,/.exec(s.slice(0, 40));
  if (!m) return null;
  const buf = Buffer.from(s.slice(m[0].length), 'base64');
  return imageSignatureOk(buf, m[1]) ? { mime: m[1], buf } : null;
}

function removeGeneratedFile(name) {
  if (name) fs.promises.unlink(path.join(GENERATED_DIR, path.basename(name))).catch(() => {});
}

/* → { mime, buf } | { url } | null */
async function readHistoryImage(id) {
  const row = db.prepare('SELECT image, image_file FROM history WHERE id=?').get(id);
  if (!row) return null;
  if (row.image_file) {
    const name = path.basename(row.image_file);
    try {
      const buf = await fs.promises.readFile(path.join(GENERATED_DIR, name));
      return { mime: IMAGE_MIME[path.extname(name).toLowerCase()] || 'application/octet-stream', buf };
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }
  if (typeof row.image === 'string') {
    if (row.image.startsWith('https://')) return { url: row.image };
    return parseImageDataUrl(row.image);   // righe vecchie con base64 nel DB
  }
  return null;
}

function pruneHistory() {
  const old = db.prepare('SELECT id, image_file FROM history ORDER BY ts DESC, id DESC LIMIT -1 OFFSET ?').all(HISTORY_MAX);
  for (const row of old) {
    db.prepare('DELETE FROM history WHERE id=?').run(row.id);
    removeGeneratedFile(row.image_file);
  }
}

/* Elenco leggero: niente immagini, solo l'URL da cui caricarle */
app.get('/api/history', (_req, res) => {
  const rows = db.prepare(`SELECT id, ts, category, ratio, style, title, subtitle, brief, prompt, text_model, image_model,
      (image_file IS NOT NULL OR image IS NOT NULL) AS has_image
    FROM history ORDER BY ts DESC, id DESC LIMIT 200`).all();
  res.json(rows.map(({ has_image, ...r }) => ({ ...r, image_url: has_image ? `/api/history/${r.id}/image` : null })));
});

app.get('/api/history/:id/image', async (req, res) => {
  try {
    const img = await readHistoryImage(Number(req.params.id));
    if (!img) return res.status(404).json({ error: 'Immagine non trovata.' });
    if (img.url) return res.redirect(img.url);
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(img.buf);
  } catch (e) {
    console.error('history image:', e.message);
    res.status(500).json({ error: 'Lettura immagine fallita.' });
  }
});

app.post('/api/history', async (req, res) => {
  let imageFile = null;
  try {
    const b = req.body || {};
    if (!HISTORY_CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'Categoria non valida.' });
    if (typeof b.image !== 'string') return res.status(400).json({ error: 'Immagine mancante.' });

    let imageRemote = null;
    const parsed = parseImageDataUrl(b.image);
    if (parsed) {
      if (!parsed.buf.length) return res.status(400).json({ error: 'Immagine vuota.' });
      imageFile = crypto.randomUUID() + EXT_FOR_MIME[parsed.mime];
      await fs.promises.writeFile(path.join(GENERATED_DIR, imageFile), parsed.buf);
    } else if (b.image.startsWith('https://') && b.image.length <= 2048) {
      imageRemote = b.image;
    } else {
      return res.status(400).json({ error: 'Formato immagine non valido.' });
    }

    const info = db.prepare(`INSERT INTO history (ts,category,ratio,style,title,subtitle,brief,prompt,image,image_file,text_model,image_model)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      Date.now(), b.category, clip(b.ratio, 20), clip(b.style, 40), clip(b.title, 500), clip(b.subtitle, 500),
      clip(b.brief, 20000), clip(b.prompt, 20000), imageRemote, imageFile, clip(b.text_model, 200), clip(b.image_model, 200));
    pruneHistory();
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    removeGeneratedFile(imageFile);
    console.error('history save:', e.message);
    res.status(500).json({ error: 'Salvataggio cronologia fallito.' });
  }
});

app.delete('/api/history/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT image_file FROM history WHERE id=?').get(id);
  db.prepare('DELETE FROM history WHERE id=?').run(id);
  if (row) removeGeneratedFile(row.image_file);
  res.json({ ok: true });
});
app.delete('/api/history', (_req, res) => {
  const rows = db.prepare('SELECT image_file FROM history WHERE image_file IS NOT NULL').all();
  db.prepare('DELETE FROM history').run();
  rows.forEach(r => removeGeneratedFile(r.image_file));
  res.json({ ok: true });
});

/* ── Start ── */
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint non trovato.' }));

/* Errori di middleware e handler sincroni (upload, JSON malformato, corpo troppo grande…):
   sempre JSON, mai pagine HTML con stack trace */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  let status = err.status || err.statusCode || 500;
  let message;
  if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File troppo grande (massimo 50 MB).' : 'Caricamento non valido.';
  } else if (err.type === 'entity.too.large') {
    status = 413; message = `Dati troppo grandi per questa richiesta (massimo ${Math.max(1, Math.round((err.limit || 0) / 1048576))} MB).`;
  } else if (err.type === 'entity.parse.failed') {
    status = 400; message = 'Richiesta non valida (JSON malformato).';
  } else if (status < 500 && err.message) {
    message = err.message;   // errori nostri con status 4xx (es. tipo di file non ammesso)
  } else {
    console.error(`${req.method} ${req.originalUrl}:`, err);
    status = 500; message = 'Errore interno del server.';
  }
  res.status(status).json({ error: message });
});

/* ── Avvio e chiusura pulita ── */
const server = app.listen(PORT, HOST, () => console.log('CoverForge Studio su http://localhost:' + PORT));

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Porta ${PORT} già in uso: un'altra istanza (o un altro programma) la sta usando. Cambia PORT in .env.`);
    process.exit(1);
  }
  throw e;
});

let closing = false;
function shutdown(reason, exitCode = 0) {
  if (closing) return;
  closing = true;
  console.log(`Chiusura (${reason})…`);
  // le richieste lunghe (generazione immagini) hanno qualche secondo per finire, poi si chiude tutto
  setTimeout(() => server.closeAllConnections?.(), 3000).unref();
  setTimeout(() => { console.error('Chiusura forzata.'); process.exit(1); }, 8000).unref();
  server.close(() => {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');   // riporta il contenuto del WAL nel file .db
      db.close();
    } catch (e) { console.error('Chiusura DB:', e.message); exitCode = exitCode || 1; }
    process.exit(exitCode);
  });
  server.closeIdleConnections?.();
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => shutdown(sig));
process.on('unhandledRejection', (e) => console.error('Promise rifiutata e non gestita:', e));
process.on('uncaughtException', (e) => { console.error('Errore non gestito:', e); shutdown('uncaughtException', 1); });