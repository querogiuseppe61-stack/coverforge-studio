const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const OR_DIRECT = 'https://openrouter.ai/api/v1';
let MODE = 'proxy';
let lastImage = null, lastMeta = null;
let lastHistoryId = null;   // riga di cronologia dell'immagine mostrata (per ⭐ Preferita)

const CATS = {
  libro:   { label:'📕 Libro',  ratios:['2:3','16:9','1:1'], hint:'book cover' },
  album:   { label:'💿 Album',  ratios:['1:1','4:5'],        hint:'album cover artwork' },
  logo:    { label:'✒️ Logo',   ratios:['1:1','4:1'],        hint:'vector-style logo, flat, clean background' },
  icona:   { label:'🔲 Icona', ratios:['1:1'],              hint:'app icon, simple bold shape' },
  header:  { label:'🖥️ Header', ratios:['16:9','3:1','21:9'],hint:'wide web header / hero banner' },
  blog:    { label:'📰 Blog',   ratios:['16:9','3:2','1.91:1','4:3','1:1'], hint:'featured image of a blog article, shown above the post and as preview when shared' }
};
const STYLES = {
  minimal:      'minimalist flat geometric design, very clean negative space, solid colors, modern typography',
  retro:        'retro vintage 1970s aesthetic, warm faded palette, grain texture, halftone, nostalgic mood',
  darkfantasy:  'dark fantasy gothic illustration, dramatic chiaroscuro, rich deep colors, epic atmosphere, detailed painting',
  corporate:    'clean corporate professional design, neutral palette with subtle accent color, structured layout, trustworthy look',
  cyberpunk:    'cyberpunk futuristic neon aesthetic, vibrant magenta/cyan palette, glowing elements, sci-fi tech details',
  watercolor:   'delicate watercolor illustration, organic textures, soft paper grain, hand-painted artistic feel',
  photo:        'photorealistic cinematic photograph, professional lighting, sharp details, film-like color grading',
  flat:         'flat vector illustration, bold simple shapes, uniform color fills, no gradients, scalable design'
};
let cat = 'libro';

/* ═══════════════════════════════════════════════════
   I N I T
   ═══════════════════════════════════════════════════ */

/* Impostazioni ricordate (modelli, tipo di progetto, formato, stile). localStorage può mancare o dare errore: mai bloccante. */
const uiGet = (k) => { try { return (JSON.parse(localStorage.getItem('cf_ui') || '{}'))[k] ?? null; } catch { return null; } };
const uiSet = (k, v) => { try { const o = JSON.parse(localStorage.getItem('cf_ui') || '{}'); o[k] = v; localStorage.setItem('cf_ui', JSON.stringify(o)); } catch {} };

/* Rende operabile da tastiera (Invio / Spazio) un elemento cliccabile che non è un <button> */
function activatable(el, label){
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  if (label) el.setAttribute('aria-label', label);
  el.addEventListener('keydown', e => {
    if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); el.click(); }
  });
  return el;
}

(function init(){
  // La chiave si ricorda solo se lo chiedi: meglio tenerla in .env, che non passa dal browser.
  let storedKey = '';
  try { storedKey = localStorage.getItem('or_key') || ''; } catch {}
  $('#apiKey').value = storedKey;
  $('#rememberKey').checked = Boolean(storedKey);
  const saveKey = () => {
    try {
      if ($('#rememberKey').checked && key()) localStorage.setItem('or_key', key());
      else localStorage.removeItem('or_key');
    } catch {}
  };
  $('#apiKey').onchange = saveKey;
  $('#rememberKey').onchange = saveKey;
  $('#wantText').onchange = e => $('#textFields').classList.toggle('hidden', !e.target.checked);

  // Guida per il prompt: la vecchia casella "Skill Prompt Master" diventa un selettore.
  // Chi l'aveva spenta resta senza guida; chi l'aveva accesa passa a quella adatta all'app.
  let guide = uiGet('guide');
  if (!guide) {
    let old = null; try { old = localStorage.getItem('pm_skill'); } catch {}
    guide = old === '0' ? 'none' : 'cover';
  }
  $('#promptGuide').value = ['cover', 'pm', 'none'].includes(guide) ? guide : 'cover';
  $('#promptGuide').onchange = e => uiSet('guide', e.target.value);
  $('#approveIdea').checked = uiGet('approve') === true;
  $('#useStyle').checked = uiGet('useStyle') === true;
  $('#styleRefs').checked = uiGet('styleRefs') === true;
  $('#refineLLM').checked = uiGet('refineLLM') !== false;   // attiva di default
  $('#refineLLM').onchange = e => uiSet('refineLLM', e.target.checked);
  $('#styleRefs').onchange = e => uiSet('styleRefs', e.target.checked);
  $('#useStyle').onchange = e => { uiSet('useStyle', e.target.checked); if (e.target.checked && !styleState.text) log('⚠ Il profilo di stile è vuoto: aggiornalo o scrivilo prima di usarlo.'); };
  const savedLimit = String(uiGet('refLimit') ?? '');
  if ([...$('#refLimit').options].some(o => o.value === savedLimit)) $('#refLimit').value = savedLimit;
  $('#refLimit').onchange = e => uiSet('refLimit', e.target.value);

  const savedCat = uiGet('cat');
  if (savedCat && CATS[savedCat]) cat = savedCat;

  const catsEl = $('#cats');
  for (const [k,v] of Object.entries(CATS)){
    const d = document.createElement('div');
    d.className = 'cat' + (k===cat?' on':''); d.textContent = v.label; d.dataset.k = k;
    d.setAttribute('aria-pressed', String(k===cat));
    d.onclick = () => {
      cat = k; uiSet('cat', k);
      document.querySelectorAll('.cat').forEach(x=>{ x.classList.toggle('on', x===d); x.setAttribute('aria-pressed', String(x===d)); });
      fillRatios();
    };
    activatable(d);
    catsEl.appendChild(d);
  }
  fillRatios();

  const savedStyle = uiGet('style');
  if (savedStyle && [...$('#style').options].some(o => o.value === savedStyle)) $('#style').value = savedStyle;
  $('#style').onchange = e => uiSet('style', e.target.value);
  $('#ratio').onchange = e => uiSet('ratio:' + cat, e.target.value);
  $('#textModel').onchange = e => uiSet('textModel', e.target.value);
  $('#imageModel').onchange = e => uiSet('imageModel', e.target.value);

  initMask();   // mascherina testo (mask.js)

  (async function(){
    try {
      const h = await fetch('/api/health');
      if (h.ok) {
        MODE = 'proxy';
        if ((await h.json().catch(() => ({}))).hasServerKey) {
          $('#apiKey').placeholder = 'Facoltativa: il server ha già una chiave (.env)';
        }
      }
    } catch { MODE = 'direct'; }
    $('#connBadge').textContent = MODE === 'proxy' ? '● proxy locale' : '● browser diretto';
    // le tre liste sono indipendenti: se una fallisce (es. OpenRouter irraggiungibile) le altre si caricano comunque
    const steps = [['modelli', () => loadModels(3)], ['cronologia', loadHistory], ['riferimenti', loadRefFiles], ['profilo di stile', loadStyle]];
    const results = await Promise.allSettled(steps.map(([, fn]) => fn()));
    results.forEach((r, i) => { if (r.status === 'rejected') log(`⚠ ${steps[i][0]}: ${r.reason.message}`); });
  })();
})();

/* Cifre del credito, scritte con attenzione a cosa sono: il limite di una chiave non è il saldo del conto */
function describeCredit(c){
  const usd = (n) => '$' + n.toFixed(2);
  const keyLimit = typeof c.keyLimitRemaining === 'number'
    ? `restano ${usd(c.keyLimitRemaining)}${typeof c.keyLimit === 'number' ? ` su ${usd(c.keyLimit)}` : ''}` : null;
  const parts = [];
  if (c.account) {
    parts.push(`Saldo del conto: ${usd(c.account.remaining)} residui (acquistati ${usd(c.account.total)}, spesi ${usd(c.account.usage)}).`);
    if (keyLimit) parts.push(`Questa chiave ha anche un limite proprio: ${keyLimit}.`);
  } else {
    parts.push(keyLimit ? `Limite di spesa impostato su questa chiave: ${keyLimit}.` : 'Nessun limite di spesa su questa chiave.');
    if (typeof c.keyUsage === 'number') parts.push(`Speso con questa chiave: ${usd(c.keyUsage)}.`);
    parts.push('Il saldo del conto non è leggibile con una chiave normale: lo trovi nella pagina Credits del tuo account su openrouter.ai.');
  }
  if (c.free) parts.push('Piano gratuito: alcuni modelli non sono disponibili.');
  return parts.join(' ');
}

/* ── Verifica connessione con OpenRouter ──
   Due passi: OpenRouter è raggiungibile? la chiave è valida (e quanto credito resta)?
   Con il server locale il controllo lo fa il server; in modalità diretta lo fa il browser. */
async function checkViaServer(){
  const r = await fetch('/api/check', { headers: { 'x-or-key': key() }, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Errore del server locale (HTTP ${r.status}).`);
  return j;
}

async function checkDirect(){
  const steps = [];
  const t0 = performance.now();
  try {
    const r = await fetch(`${OR_DIRECT}/models`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`risposta HTTP ${r.status}`);
    const n = (await r.json()).data?.length ?? 0;
    steps.push({ ok: true, detail: `OpenRouter raggiungibile (${Math.round(performance.now() - t0)} ms, ${n} modelli disponibili).` });
  } catch (e) {
    steps.push({ ok: false, detail: `Impossibile raggiungere OpenRouter: ${e.name === 'TimeoutError' ? 'nessuna risposta entro 10 secondi' : e.message}.` });
    return { ok: false, steps };
  }
  if (!key()) { steps.push({ ok: false, detail: 'Nessuna chiave: scrivila nel campo qui sopra.' }); return { ok: false, steps }; }
  let res = null;
  for (const route of ['/key', '/auth/key']) {
    try {
      const r = await fetch(`${OR_DIRECT}${route}`, { headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(10000) });
      if (r.status === 404) continue;
      if (r.status === 401 || r.status === 403) { steps.push({ ok: false, detail: 'Chiave non valida o revocata.' }); return { ok: false, steps }; }
      if (!r.ok) throw new Error(`risposta HTTP ${r.status}`);
      res = (await r.json()).data || {};
      break;
    } catch (e) { steps.push({ ok: false, detail: `Controllo della chiave non riuscito: ${e.message}.` }); return { ok: false, steps }; }
  }
  if (!res) { steps.push({ ok: false, detail: 'Controllo della chiave non disponibile.' }); return { ok: false, steps }; }
  const num = (v) => (typeof v === 'number' ? v : null);
  let account = null;
  try {   // il saldo del conto lo dà solo una management key; con le altre risponde 403 e si ignora
    const r = await fetch(`${OR_DIRECT}/credits`, { headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const cd = (await r.json()).data || {};
      if (num(cd.total_credits) !== null && num(cd.total_usage) !== null) account = { total: cd.total_credits, usage: cd.total_usage, remaining: cd.total_credits - cd.total_usage };
    }
  } catch { /* saldo non leggibile */ }
  steps.push({ ok: true, detail: 'Chiave valida.', credit: {
    account, keyLimit: num(res.limit), keyLimitRemaining: num(res.limit_remaining), keyUsage: num(res.usage), free: res.is_free_tier === true
  } });
  return { ok: true, steps };
}

async function checkConnection(){
  const btn = $('#btnCheck'), box = $('#checkResult');
  btn.disabled = true;
  const wait = document.createElement('div'); wait.className = 'check-line'; wait.textContent = 'Verifico la connessione…';
  box.replaceChildren(wait);
  let result;
  try { result = MODE === 'proxy' ? await checkViaServer() : await checkDirect(); }
  catch (e) { result = { ok: false, steps: [{ ok: false, detail: e.name === 'TimeoutError' ? 'Nessuna risposta dal server locale entro 30 secondi.' : e.message }] }; }
  box.replaceChildren(...result.steps.map(s => {
    const d = document.createElement('div');
    d.className = 'check-line ' + (s.ok ? 'ok' : 'ko');
    d.textContent = (s.ok ? '✔ ' : '✖ ') + s.detail + (s.credit ? ' ' + describeCredit(s.credit) : '');
    return d;
  }));
  const bad = result.steps.find(s => !s.ok);
  log(bad ? `Verifica connessione: ${bad.detail}` : 'Verifica connessione: tutto in ordine.');
  btn.disabled = false;
}
$('#btnCheck').onclick = checkConnection;

function fillRatios(){
  const r = $('#ratio'); r.innerHTML = '';
  CATS[cat].ratios.forEach(x => r.add(new Option(x, x)));
  const saved = uiGet('ratio:' + cat);
  if (saved && CATS[cat].ratios.includes(saved)) r.value = saved;
}
const key = () => $('#apiKey').value.trim();

/* Pulsante Annulla: l'operazione in corso (busy) ha un AbortController; ogni richiesta ha inoltre un timeout
   un po' più lungo di quello del server, così di solito arriva prima il messaggio del server. */
let activeAbort = null;
const CLIENT_TIMEOUT = { models: 30000, craft: 120000, generate: 210000, 'style-profile/build': 150000 };

async function orFetch(route, body, method='POST'){
  const signals = [AbortSignal.timeout(CLIENT_TIMEOUT[route.replace('/api/', '')] || 120000)];
  if (activeAbort) signals.push(activeAbort.signal);
  const signal = AbortSignal.any(signals);
  try {
    if (MODE === 'proxy') {
      const r = await fetch(route, { method, signal, headers:{'Content-Type':'application/json','x-or-key':key()}, body: body?JSON.stringify(body):undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Errore del server locale (HTTP ${r.status}).`);
      return j;
    }
    const url = route.replace(/^\/api\/models/,`${OR_DIRECT}/models`).replace(/^\/api\/(craft|generate)/,`${OR_DIRECT}/chat/completions`);
    const r = await fetch(url, { method, signal, headers:{'Authorization':`Bearer ${key()}`,'Content-Type':'application/json','HTTP-Referer':location.origin,'X-Title':'CoverForge Studio'}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `Errore OpenRouter (HTTP ${r.status}).`);
    if (route === '/api/models') {
      const text = [], image = [];
      for (const m of (Array.isArray(j.data) ? j.data : [])) {
        const out = m.architecture?.output_modalities || [], inn = m.architecture?.input_modalities || [];
        const entry = { id: m.id, name: m.name, vision: inn.includes('image') };
        if (out.includes('image')) image.push(entry);
        if (out.includes('text')) text.push(entry);
      }
      return { text, image };
    }
    const msg = j.choices?.[0]?.message;
    if (!msg) throw new Error('Risposta di OpenRouter non valida.');
    if (route === '/api/craft') return { content: msg.content };
    const imgs = (msg.images||[]).map(i=>i.image_url?.url).filter(Boolean);
    if (!imgs.length) throw new Error('Nessuna immagine: scegli un modello grafico con output image');
    return { images: imgs };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Operazione annullata.');
    if (e.name === 'TimeoutError') throw new Error('Tempo scaduto: nessuna risposta dal servizio.');
    if (e instanceof TypeError) throw new Error(MODE === 'proxy' ? 'Server locale non raggiungibile: è ancora in esecuzione?' : 'Connessione a OpenRouter non riuscita.');
    throw e;
  }
}

/* retries: nuovi tentativi automatici (ogni 15 s) se la lista non si carica */
async function loadModels(retries = 0){
  log('Carico i modelli da OpenRouter…');
  let m;
  try { m = await orFetch('/api/models', null, 'GET'); }
  catch (e) {
    if (retries > 0) { log(`Modelli non disponibili (${e.message}) — riprovo fra 15 secondi (puoi anche usare «Verifica connessione»).`); setTimeout(() => loadModels(retries - 1).catch(() => {}), 15000); return; }
    throw e;
  }
  const defT = ['anthropic/claude-sonnet-4.5','openai/gpt-4o','google/gemini-2.5-flash'];
  const defI = ['google/gemini-2.5-flash-image-preview','openai/gpt-image-1'];
  fill('#textModel',  m.text,  defT);
  fill('#imageModel', m.image, defI);
  log(`Pronto: ${m.text.length} testo, ${m.image.length} immagine.`);
}
/* id modello di testo → accetta immagini in ingresso? (campo "vision" del server) */
const MODEL_VISION = new Map();
const textModelSeesImages = () => MODEL_VISION.get($('#textModel').value) === true;

function fill(sel, list, defs){
  const el = $(sel); el.innerHTML = '';
  if (sel === '#textModel') list.forEach(x => MODEL_VISION.set(x.id, x.vision === true));
  list.sort((a,b)=>a.name.localeCompare(b.name)).forEach(x=>el.add(new Option(sel === '#textModel' && x.vision ? `${x.id}  👁` : x.id, x.id)));
  const saved = uiGet(sel.slice(1));   // '#textModel' → 'textModel'
  const d = [saved, ...defs].find(x => x && list.some(y => y.id === x));
  if (d) el.value = d;
}

/* ── Reference files ────────────────────────────── */

async function loadRefFiles(){
  if (MODE !== 'proxy') { $('#refList').innerHTML = ''; $('#refEmpty').classList.remove('hidden'); return; }
  try {
    const rows = await fetch('/api/ref-files').then(r=>r.json());
    const list = $('#refList'); list.innerHTML = '';
    if (!rows.length) { $('#refEmpty').classList.remove('hidden'); return; }
    $('#refEmpty').classList.add('hidden');
    rows.forEach(row => {
      const d = document.createElement('div'); d.className = 'ref-item';
      const icon = typeIcon(row.file_type);
      d.innerHTML = `
        <span class="ref-icon">${icon}</span>
        <span class="ref-name" title="${escapeHtml(row.original_name)}">${escapeHtml(row.original_name)}</span>
        <label class="ref-toggle" title="Includi come riferimento">
          <input type="checkbox" aria-label="Usa come riferimento: ${escapeHtml(row.original_name)}" data-id="${row.id}" data-type="${row.file_type}" data-stored="${escapeHtml(row.stored_name)}" data-name="${escapeHtml(row.original_name)}">
        </label>
        ${row.file_type === 'image' ? `<button class="ref-open" title="Apri nel riquadro del risultato: da lì puoi rifinirla, comporre il testo o esportarla" aria-label="Apri ${escapeHtml(row.original_name)}">✎</button>` : ''}
        ${row.file_type === 'image' ? `<button class="ref-style${row.style_example ? ' on' : ''}" aria-pressed="${row.style_example ? 'true' : 'false'}" title="Esempio del mio stile: entra nell'archivio da cui si ricava il profilo" aria-label="Esempio di stile: ${escapeHtml(row.original_name)}">🎨</button>` : ''}
        <button class="ref-del" data-id="${row.id}" title="Rimuovi" aria-label="Rimuovi ${escapeHtml(row.original_name)}">✕</button>
      `;
      const op = d.querySelector('.ref-open');
      if (op) op.onclick = () => openOnStage(`/uploads/${row.stored_name}`, row.original_name);
      const st = d.querySelector('.ref-style');
      if (st) st.onclick = () => toggleMark(st, `/api/ref-files/${row.id}/style`, 'style');
      d.querySelector('.ref-del').onclick = async () => {
        await fetch('/api/ref-files/'+row.id, {method:'DELETE'});
        loadRefFiles(); loadStyle();
      };
      list.appendChild(d);
    });
  } catch(e){ console.error('ref files:', e); }
}

function typeIcon(type){
  const map = { image:'🖼️', txt:'📄', md:'📝', pdf:'📕', docx:'📘' };
  return map[type] || '📄';
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

function getSelectedRefs(){
  const cbs = $$('#refList input[type="checkbox"]:checked');
  return Array.from(cbs).map(cb => ({
    id: cb.dataset.id,
    type: cb.dataset.type,
    name: cb.dataset.name
  }));
}

function getSelectedImageUrls(){
  return Array.from($$('#refList input[type="checkbox"]:checked'))
    .filter(cb => cb.dataset.type === 'image')
    .map(cb => `/uploads/${cb.dataset.stored}`)
    .filter(Boolean);
}

const REF_TEXT_TOTAL_CAP = 60000;   // caratteri complessivi dei riferimenti di testo per richiesta
const BLOG_MIN_CHARS = 30000;       // circa 5.000 parole: per il tipo Blog l'articolo si legge di norma per intero
const nf = (n) => n.toLocaleString('it-IT');

/* Testi dei file spuntati: per ciascuno al più "refLimit" caratteri (inizio, metà e fine se è più lungo),
   e comunque non più di REF_TEXT_TOTAL_CAP in tutto. */
async function buildRefContext(){
  const selected = getSelectedRefs().filter(s => s.type !== 'image');
  if (!selected.length) return { context: '', used: [] };
  // per l'immagine di un articolo serve l'articolo intero (tono e spirito stanno anche nello sviluppo e nella chiusa):
  // almeno BLOG_MIN_CHARS per file, che coprono un post lungo
  const wanted = Math.max(Number($('#refLimit').value) || 4000, cat === 'blog' ? BLOG_MIN_CHARS : 0);
  const perFile = Math.max(1000, Math.min(wanted, Math.floor(REF_TEXT_TOTAL_CAP / selected.length)));
  const used = [], parts = [];
  for (const sel of selected) {
    try {
      const r = await fetch(`/api/ref-files/${encodeURIComponent(sel.id)}/text?limit=${perFile}`);
      if (!r.ok) throw new Error(r.status);
      const { name, text, sampled, total } = await r.json();
      if (!text) { log(`⚠ Nessun testo estratto da "${sel.name}": ignorato.`); continue; }
      used.push({ name, chars: text.length, total, sampled });
      const how = sampled ? `estratto di ${nf(text.length)} caratteri su ${nf(total)}: inizio, metà e fine` : 'testo completo';
      parts.push(`=== Riferimento "${name}" (${how}) ===\n${text}\n`);
    } catch (e) { log(`⚠ Impossibile leggere "${sel.name}": ${e.message}`); }
  }
  return { context: parts.join('\n'), used };
}

/* Immagini spuntate ridotte (max 3, lato 768 px, JPEG): il modello di testo con la vista le riceve nel messaggio */
async function buildRefImageParts(){
  const parts = [];
  for (const url of getSelectedImageUrls().slice(0, 3)) {
    try { parts.push({ type: 'image_url', image_url: { url: await downscaleJpeg(url, 768) } }); }
    catch { log(`⚠ Immagine di riferimento non leggibile: ${url.split('/').pop()}`); }
  }
  return parts;
}

/* Immagine ridotta (lato massimo `side` px) in JPEG data URL, su fondo bianco per le trasparenze */
async function downscaleJpeg(url, side){
  const img = await maskLoadImage(url);
  const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

/* File upload via drag & drop + button */

function setupFileUpload(){
  $('#btnRefUpload').onclick = () => $('#refFileInput').click();
  $('#refFileInput').onchange = async (e) => {
    for (const file of e.target.files) await uploadFile(file);
    e.target.value = '';
    await loadRefFiles();
  };
  const area = $('#refDropArea');
  area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('dragover'); });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', async (e) => {
    e.preventDefault(); area.classList.remove('dragover');
    for (const file of e.dataTransfer.files) await uploadFile(file);
    await loadRefFiles();
  });
}

async function uploadFile(file){
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await fetch('/api/ref-files/upload', { method:'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    log(`Allegato: ${file.name}`);
    if (j.text_extracted === false) log(`⚠ Nessun testo estratto da "${file.name}" (PDF scansionato o file vuoto?).`);
  } catch(e){ log('Errore upload: '+e.message); }
}

/* ── Prompt engineer ── */

/* Guida per il prompt: «CoverForge» (prompt-guide/cover-forge.md, a sezioni: generale + tipo di progetto + testo
   sì/no + riferimenti) oppure «Prompt Master» (estratti di prompt-master-main/). Servono entrambe il server locale. */
let pmContent = null;

async function loadGuide() {
  const mode = $('#promptGuide').value;
  if (mode === 'none') return null;
  if (MODE !== 'proxy') { log('⚠ La guida per il prompt richiede il server locale: proseguo senza.'); return null; }
  try {
    if (mode === 'pm') {
      if (!pmContent) {
        const r = await fetch('/api/prompt-master');
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        pmContent = (await r.json()).content || null;
      }
      return pmContent;
    }
    const r = await fetch('/api/prompt-guide');   // il server la rilegge solo se il file è cambiato
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    const g = (await r.json()).sections;
    return [g.generale, g[cat], $('#wantText').checked ? g.testo : g['senza-testo'],
      getSelectedImageUrls().length ? g.riferimenti : ''].filter(Boolean).join('\n\n');
  } catch (e) { log('⚠ Guida per il prompt non disponibile: ' + e.message); return null; }
}

function buildContextBlock(ctx) {
  if (!ctx || !ctx.trim()) return '';
  return `\n\nContesto di ispirazione (riferimenti allegati dall'utente):\n${ctx}\n`;
}

/* Come leggere i testi allegati, per tipo di progetto: un racconto, un testo di canzone e un brief di marca
   non vanno interpretati allo stesso modo. Sta nel codice (non nella guida) così vale con qualunque guida. */
const REF_TEXT_HINT = {
  libro: "I testi di riferimento sono parti del libro o materiali su di esso. Se è narrativa ricava personaggi, ambientazione, atmosfera e simboli ricorrenti; se è un saggio ricava il tema, la tesi centrale e il tono. Non citarli alla lettera.",
  album: "I testi di riferimento sono canzoni o note sul disco. Ricava i temi, le emozioni, l'atmosfera, le immagini poetiche ricorrenti e il genere o le sonorità suggerite. Non citare versi.",
  logo: "I testi di riferimento descrivono la marca. Ricava cosa fa, a chi si rivolge, i valori, il tono di voce e le parole chiave, e traducili in un simbolo semplice e riconoscibile. Rispetta le indicazioni su colori, forme e stile se presenti.",
  icona: "I testi di riferimento descrivono l'app o il prodotto. Ricava la funzione principale e scegli UN solo concetto da rappresentare con un solo simbolo. Rispetta le indicazioni su colori e stile se presenti.",
  header: "I testi di riferimento sono l'articolo o la pagina a cui serve l'header, oppure descrivono il tono del sito. Ricava l'argomento e il tono e proponi un'immagine che li evochi senza illustrarli alla lettera. Rispetta le indicazioni di stile se presenti.",
  blog: `I testi di riferimento sono l'articolo del blog a cui serve l'immagine principale: è la fonte più importante, più del brief. Leggilo tutto, compresa la chiusa, e ricava:
1) l'ARGOMENTO vero, cioè di cosa parla davvero e qual è la sua idea centrale, non solo la parola chiave del titolo;
2) il TONO, cioè come è scritto (ironico, polemico, intimo, divulgativo, tecnico, malinconico, entusiasta, provocatorio…);
3) lo SPIRITO, cioè l'intenzione e l'emozione che lascia al lettore (indignazione, speranza, curiosità, nostalgia, invito ad agire…).
L'immagine deve rendere insieme tutte e tre le cose: chi la vede, prima di leggere, deve intuire il tema e il registro dell'articolo. Tono e spirito decidono luce, palette, stile e atmosfera: un pezzo ironico non ha un'immagine solenne, uno intimo non ha un'immagine da comunicato aziendale.
Le indicazioni dell'utente nel brief si rispettano (elementi richiesti, stile, colori, vincoli), ma restano dentro il tono e lo spirito dell'articolo, salvo che l'utente chieda espressamente un registro diverso. Non citare frasi dell'articolo e non scrivere il titolo nell'immagine se non è richiesto.`
};

/* Profilo di stile dell'utente: orienta il gusto, ma viene dopo il brief e lo stile scelto nel menu */
const USER_STYLE_HINT = {
  blog: "Per l'immagine di un articolo: tono e spirito dell'articolo decidono l'atmosfera, il profilo decide il trattamento grafico (tecnica, palette di base, composizione).",
  logo: "Per un logo applica del profilo solo palette e gusto generale: la semplicità richiesta resta la regola.",
  icona: "Per un'icona applica del profilo solo palette e gusto generale: la semplicità richiesta resta la regola."
};
function userStyleBlock(profile){
  if (!profile) return '';
  return `\n\n=== STILE PREFERITO DELL'UTENTE ===\n${profile}\n=== FINE STILE ===
È il gusto grafico dell'utente, ricavato dalle immagini che ha scelto. Orienta tecnica, palette, luce, composizione e trattamento verso questo stile.
Priorità: le richieste esplicite del brief e lo stile artistico obbligatorio, se indicato, vengono prima; il profilo decide ciò che il brief non decide. È uno stile, non un tema: non riprendere i soggetti delle immagini da cui è stato ricavato.${USER_STYLE_HINT[cat] ? ' ' + USER_STYLE_HINT[cat] : ''}`;
}

/* images: { n, seen } — quante immagini sono allegate e se il modello di testo le vede */
function sysPrompt(mode, refContext, guide, images, concept = false, userStyle = ''){
  const c = CATS[cat], ratio = $('#ratio').value;
  const styleVal = $('#style').value;
  const styleHint = (styleVal ? `\nStile artistico OBBLIGATORIO: ${STYLES[styleVal]}.` : '') + userStyleBlock(userStyle);
  const ctx = buildContextBlock(refContext);
  const guideBlock = guide ? `\n\n=== GUIDA PER IL PROMPT ===\n${guide}\n=== FINE GUIDA ===\n` : '';
  const imgNote = !images.n ? ''
    : images.seen ? `\n\nAllegate ${images.n} immagini di riferimento: le vedi nel messaggio dell'utente. Ricavane stile, palette e composizione; il generatore le riceverà insieme al prompt.`
    : `\n\nAl generatore verranno allegate ${images.n} immagini di riferimento che tu non vedi: non descriverle né inventarne il contenuto.`;
  const base = `Sei un art director e prompt engineer per modelli di generazione immagini.
Formato obbligatorio: ${ratio} (${c.hint}).${styleHint}${ctx}${imgNote}${guideBlock}`;
  const txt = $('#wantText').checked
    ? `Testo DA inserire ESATTAMENTE: titolo "${$('#titleTxt').value||''}", secondario "${$('#subTxt').value||''}". Riserva spazio leggibile.`
    : `Nessun testo nell'immagine.`;
  const textRefs = refContext ? (REF_TEXT_HINT[cat] || REF_TEXT_HINT.libro) : '';
  // per il blog il modello scrive prima la sua lettura dell'articolo: un campo da compilare lo obbliga a leggerlo davvero
  const blogRead = cat === 'blog' && refContext;
  const articoloField = blogRead ? '"articolo":{"argomento":"...","tono":"...","spirito":"..."},' : '';
  const articoloRule = blogRead ? `\n- "articolo": la tua lettura dell'articolo, in italiano, una frase per campo: argomento e idea centrale, tono, spirito. Il resto della risposta deve discendere da qui.` : '';
  const imgRule = images.n && mode !== 'ideas'
    ? 'Nel prompt includi una frase che chieda al generatore di usare le immagini allegate come riferimento (stile, palette, atmosfera) senza copiarle.' : '';
  if (mode === 'ideas') return `${base}
Proponi 3 concept creativi DIVERSI. ${textRefs}${blogRead ? ' Tutte e tre le proposte devono essere fedeli al tono e allo spirito dell\'articolo: diverse nell\'idea visiva, non nel registro.' : ''}
Rispondi SOLO JSON: {${articoloField}"ideas":[{"title":"...","concept":"descrizione in italiano, 40-70 parole"}]}${articoloRule}`;
  // Con la guida CoverForge il modello passa da un'idea scritta: prima scarta le immagini più ovvie, poi sceglie il concept,
  // poi scrive il prompt. Un'istruzione generica ("evita i cliché") viene facilmente ignorata; un campo da compilare no.
  const schema = concept
    ? `Rispondi SOLO JSON con questi campi, in quest'ordine:
{${articoloField}"ovvie":["...","..."],"concept":"...","prompt":"..."}${articoloRule}
- "ovvie": le 5 immagini più prevedibili per questo tema. Includi sia quelle letterali (il soggetto mostrato com'è) sia le metafore più usate dall'editoria (due mani che si toccano, uomo contro macchina, mezzo volto e mezzo circuito, la lampadina, la scalata, il bivio, la bilancia). Servono solo per scartarle.
- "concept": in una frase l'idea visiva scelta. Non deve essere una variante di nessuna delle ovvie. ${cat === 'blog'
    ? "Preferisci un oggetto, un gesto o un luogo concreto e specifico del mondo dell'articolo a una metafora astratta sul tema, e fai in modo che luce e atmosfera dicano il tono e lo spirito che hai letto."
    : "Per un libro non narrativo preferisci un oggetto, un gesto o un luogo concreto e specifico del mondo del libro a una metafora astratta sul tema, oppure un trattamento grafico insolito; per un romanzo i simboli del genere vanno bene, con un'angolatura meno scontata."}
- "prompt": il prompt finale in inglese (60-140 parole) che realizza il concept.`
    : `Rispondi SOLO JSON: {${articoloField}"prompt":"..."}${articoloRule}`;
  return `${base} ${txt}
Trasforma il brief in UN prompt tecnico in INGLESE (i modelli grafici rendono meglio in inglese). ${textRefs} ${imgRule}
Struttura: soggetto → composizione/spazi negativi → stile/medium → illuminazione → palette → dettagli qualitativi.
${concept ? '' : '60-140 parole. '}${schema}`;
}

/* Contesto completo di una richiesta al modello di testo: prompt di sistema + messaggio dell'utente.
   Se il modello ha la vista e ci sono immagini spuntate, le immagini ridotte viaggiano nel messaggio. */
async function buildTextRequest(mode, userText){
  const refs = await buildRefContext();
  const guide = await loadGuide();
  const nImg = getSelectedImageUrls().length;
  const seen = nImg > 0 && textModelSeesImages();
  const parts = seen ? await buildRefImageParts() : [];
  const images = { n: nImg, seen: parts.length > 0 };
  const useConcept = mode === 'prompt' && $('#promptGuide').value === 'cover' && Boolean(guide);
  const userStyle = $('#useStyle').checked && MODE === 'proxy' ? styleState.text.trim() : '';
  if ($('#useStyle').checked && !userStyle) log('⚠ «Usa il mio stile» è attivo ma il profilo è vuoto: proseguo senza.');
  const system = { role: 'system', content: sysPrompt(mode, refs.context, guide, images, useConcept, userStyle) };
  const user = parts.length ? { role: 'user', content: [{ type: 'text', text: userText }, ...parts] } : { role: 'user', content: userText };
  const notes = [];
  if (cat === 'blog' && !refs.used.length) log('⚠ Blog: nessun articolo spuntato nei Riferimenti. Allega il testo dell\'articolo (txt, md, PDF, DOCX) e spuntalo: il prompt ne segue argomento, tono e spirito. Proseguo solo con il brief.');
  if (refs.used.length) notes.push(`testi: ${refs.used.map(u => `${u.name} (${nf(u.chars)}${u.sampled ? ' su ' + nf(u.total) : ''} car.)`).join(', ')}`);
  if (nImg) notes.push(images.seen ? `${parts.length} immagini viste dal modello di testo` : `${nImg} immagini solo per il generatore (il modello di testo non ha la vista)`);
  if (guide) notes.push(`guida «${$('#promptGuide').selectedOptions[0].textContent}»`);
  if (userStyle) notes.push('il mio stile');
  if (notes.length) log('Uso nel prompt → ' + notes.join(' · '));
  return [system, user];
}

/* Primo oggetto JSON bilanciato nel testo (ignora recinti ``` e frasi intorno) */
function extractJSON(s){
  const text = String(s ?? '').replace(/```(?:json)?/gi, '');
  for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { try { return JSON.parse(text.slice(i, j + 1)); } catch { break; } }
    }
  }
  throw new Error('il modello non ha risposto in formato JSON');
}

/* Chiede un JSON al modello di testo; se la risposta non è valida lo richiede una volta */
async function askJSON(messages){
  for (let attempt = 0; ; attempt++) {
    const r = await orFetch('/api/craft', { model: $('#textModel').value, messages });
    try { return extractJSON(r.content); }
    catch (e) {
      if (attempt >= 1) throw new Error(e.message + ': riprova o scegli un altro modello.');
      log('Risposta non in formato JSON: la richiedo una volta.');
      messages = [...messages, { role: 'assistant', content: String(r.content ?? '') },
        { role: 'user', content: 'Rispondi SOLO con JSON valido nel formato richiesto, senza altro testo.' }];
    }
  }
}

/* ── Azioni principali ── */
$('#btnIdeas').onclick = async () => {
  busy(true); log('Chiedo 3 proposte al LLM…');
  try {
    const messages = await buildTextRequest('ideas', $('#brief').value.trim() || 'sorprendimi');
    const j = await askJSON(messages);
    const ideas = j.ideas;
    const reading = articleReading(j);
    if (reading) log(`📰 Lettura dell'articolo → ${reading}`);
    if (!Array.isArray(ideas) || !ideas.length) throw new Error('il modello non ha restituito proposte');
    const box = $('#ideasBox'); box.innerHTML=''; box.classList.remove('hidden');
    ideas.forEach(i => {
      const d = document.createElement('div'); d.className='idea';
      const t = document.createElement('b'); t.textContent = String(i.title ?? '');
      d.append(t, document.createElement('br'), document.createTextNode(String(i.concept ?? '')));
      d.onclick = () => { $('#brief').value = String(i.concept ?? ''); box.classList.add('hidden'); craft(); };
      activatable(d);
      box.appendChild(d);
    });
  } catch(e){ log('Errore proposte: '+e.message); }
  busy(false);
};

$('#btnGo').onclick = () => craft();

/* ── Conferma dell'idea ──
   Con la casella spuntata, craft() si ferma dopo aver scritto il prompt e mostra l'idea scelta:
   si può generare, chiedere un'altra idea (il modello riceve l'elenco di quelle rifiutate) o chiudere. */
let rejectedIdeas = [];
let lastProposal = null;   // { label } testo da ricordare se l'utente rifiuta la proposta

/* Lettura dell'articolo (tipo Blog): { argomento, tono, spirito } → testo breve, '' se manca */
function articleReading(j){
  const a = j && typeof j.articolo === 'object' && j.articolo ? j.articolo : null;
  if (!a) return '';
  return [['Argomento', a.argomento], ['Tono', a.tono], ['Spirito', a.spirito]]
    .filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => `${k}: ${v.trim()}`).join(' · ');
}

function hideApproval(){ $('#approvalBox').classList.add('hidden'); }

function showApproval(j){
  const concept = typeof j.concept === 'string' ? j.concept.trim() : '';
  const skipped = Array.isArray(j.ovvie) ? j.ovvie.filter(x => typeof x === 'string').slice(0, 5) : [];
  $('#approvalConcept').textContent = concept || 'Il prompt è pronto: controllalo qui sotto prima di generare.';
  $('#approvalSkipped').textContent = skipped.length ? `Scartate: ${skipped.join(' · ')}` : '';
  $('#approvalArticle').textContent = articleReading(j);
  lastProposal = { label: concept || String(j.prompt).slice(0, 200) };
  const box = $('#approvalBox');
  box.classList.remove('hidden');
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $('#btnApprove').focus({ preventScroll: true });
}

$('#btnApprove').onclick = () => { hideApproval(); generate(); };
$('#btnAnother').onclick = () => { if (lastProposal) rejectedIdeas.push(lastProposal.label); craft({ again: true }); };
$('#btnApprovalClose').onclick = hideApproval;
$('#approveIdea').onchange = e => uiSet('approve', e.target.checked);

async function craft({ again = false } = {}){
  if (!again) rejectedIdeas = [];
  hideApproval();
  busy(true); log(again ? 'Cerco un\'altra idea…' : 'Il LLM scrive il prompt tecnico…');
  try {
    // l'elenco delle idee rifiutate va solo al modello: il testo del brief nella pagina non cambia
    const brief = $('#brief').value + (rejectedIdeas.length
      ? `\n\n[Proposte già fatte e rifiutate dall'utente: ${rejectedIdeas.map(x => `"${x}"`).join('; ')}. Proponi un'idea sostanzialmente diversa da tutte.]` : '');
    const messages = await buildTextRequest('prompt', brief);
    const j = await askJSON(messages);
    if (typeof j.prompt !== 'string' || !j.prompt.trim()) throw new Error('la risposta del modello non contiene il prompt');
    $('#promptOut').value = j.prompt;
    const reading = articleReading(j);
    if (reading) log(`📰 Lettura dell'articolo → ${reading}`);
    if (typeof j.concept === 'string' && j.concept.trim()) {
      const scartate = Array.isArray(j.ovvie) ? j.ovvie.filter(x => typeof x === 'string').slice(0, 3).join('; ') : '';
      log(`💡 Idea scelta: ${j.concept.trim()}${scartate ? ` (scartate: ${scartate})` : ''}`);
    }
    if ($('#approveIdea').checked) {
      log('Prompt pronto: attendo la tua conferma.');
      busy(false);          // prima si riabilitano i pulsanti, altrimenti il focus non può andare su "Genera"
      showApproval(j);
      return;
    }
    log('Prompt pronto. Genero…');
    await generate();
  } catch(e){ log('Errore craft: '+e.message); busy(false); }
}

$('#btnGen').onclick = () => generate();
$('#btnRe').onclick = () => generate('Small variation of the same concept, keep coherence: ');
async function generate(prefix=''){
  const prompt = prefix + $('#promptOut').value;
  if (!prompt.trim()) return log('Scrivi o genera prima un prompt.');
  busy(true); log(`Genero con ${$('#imageModel').value}…`);
  $('#stage').innerHTML = '<div class="spin"></div>';
  try {
    const refImages = getSelectedImageUrls();
    const styleRefs = styleRefImages(refImages);
    // le immagini di stile vanno in coda: la frase aggiunta al prompt le indica come «le ultime N»
    const fullPrompt = styleRefs.length ? `${prompt}\n\n${styleRefsSentence(styleRefs.length)}` : prompt;
    const r = await orFetch('/api/generate', { model: $('#imageModel').value, prompt: fullPrompt, referenceImages: [...refImages, ...styleRefs] });
    showImage(r.images[0], { prompt });
    log('Immagine ricevuta ✔');
  } catch(e){
    const ph = document.createElement('div'); ph.className = 'placeholder'; ph.setAttribute('role', 'alert'); ph.textContent = e.message;
    $('#stage').replaceChildren(ph);
    log('Errore: '+e.message);
  }
  busy(false);
}

/* ── Rifinitura ──
   Il modello grafico rigenera l'immagine seguendo l'originale: l'istruzione deve dire cosa cambiare e cosa conservare.
   Con «L'LLM prepara l'istruzione» la richiesta dell'utente diventa un'istruzione precisa in inglese. */
const wantsMyStyle = (instr) => /\bmio stile\b/i.test(instr);

async function editGuide(){
  if ($('#promptGuide').value !== 'cover' || MODE !== 'proxy') return '';
  try {
    const r = await fetch('/api/prompt-guide');
    return r.ok ? (await r.json()).sections.modifica || '' : '';
  } catch { return ''; }
}

async function craftEditPrompt(instr, source, sourceMeta){
  const profile = ($('#useStyle').checked || wantsMyStyle(instr)) && MODE === 'proxy' ? styleState.text.trim() : '';
  if (wantsMyStyle(instr) && !profile) log('⚠ Hai chiesto «il mio stile» ma il profilo di stile è vuoto.');
  let parts = [];
  if (textModelSeesImages()) {
    try { parts = [{ type: 'image_url', image_url: { url: await downscaleJpeg(source, 768) } }]; }
    catch { log('⚠ Il modello di testo non può vedere questa immagine: preparo l\'istruzione senza.'); }
  }
  const guide = await editGuide();
  const system = `Sei un fotoritoccatore e prompt engineer. L'utente vuole modificare un'immagine esistente con un modello grafico conversazionale, che riceve l'immagine e un'istruzione in inglese e rigenera l'immagine seguendola.
Tipo di progetto: ${CATS[cat].hint}.${sourceMeta?.prompt ? `\nPrompt con cui l'immagine era stata creata: ${sourceMeta.prompt}` : ''}
${parts.length ? "L'immagine da modificare è allegata al messaggio: guardala e nomina gli elementi da conservare con le loro caratteristiche visibili." : "Non vedi l'immagine: non inventarne il contenuto e riferisciti agli elementi in modo generico."}${profile ? `\n\n=== STILE PREFERITO DELL'UTENTE ===\n${profile}\n=== FINE STILE ===\nSe la richiesta riguarda lo stile o «il mio stile», porta tecnica, palette, luce e texture verso questo profilo.` : ''}

Scrivi l'istruzione di modifica:
- dice con precisione COSA cambiare, con parole concrete (luce, colori, materiali, elementi);
- dice esplicitamente cosa CONSERVARE identico: soggetto, composizione e inquadratura, pose e volti, proporzioni, eventuale testo già presente, salvo che la richiesta li riguardi;
- una sola modifica coerente: se la richiesta è vaga scegli l'interpretazione più fedele, senza aggiungere cambiamenti non richiesti;
- in inglese, 30-90 parole, frasi descrittive, niente elenchi né markdown.${guide ? `\n\n=== GUIDA PER LE MODIFICHE ===\n${guide}\n=== FINE GUIDA ===` : ''}

Rispondi SOLO JSON: {"cambia":"in italiano, in una frase, cosa cambierà","conserva":"in italiano, in una frase, cosa resta uguale","prompt":"l'istruzione in inglese"}`;
  const user = parts.length ? { role: 'user', content: [{ type: 'text', text: instr }, ...parts] } : { role: 'user', content: instr };
  const j = await askJSON([{ role: 'system', content: system }, user]);
  if (typeof j.prompt !== 'string' || !j.prompt.trim()) throw new Error('la risposta del modello non contiene l\'istruzione');
  return j;
}

$('#btnRefine').onclick = async () => {
  const instr = $('#refineTxt').value.trim(); if (!instr || !lastImage) return;
  const source = lastImage, sourceMeta = lastMeta;
  busy(true);
  try {
    let prompt;
    if ($('#refineLLM').checked) {
      log('L\'LLM prepara l\'istruzione di modifica…');
      const j = await craftEditPrompt(instr, source, sourceMeta);
      prompt = j.prompt.trim();
      log(`✎ Cambia: ${String(j.cambia ?? '').trim() || '—'} · Resta: ${String(j.conserva ?? '').trim() || '—'}`);
    } else {
      prompt = `Edit this image: ${instr}. Keep overall composition and style.`;
      if (wantsMyStyle(instr) && styleState.text.trim()) prompt += `\nTarget style (described in Italian): ${styleState.text.trim()}`;
    }
    log('Rifinisco…');
    const r = await orFetch('/api/generate', { model: $('#imageModel').value, prompt, referenceImages: [source] });
    // il prompt d'origine segue la catena delle modifiche; parent permette confronto e ritorno
    showImage(r.images[0], { prompt: sourceMeta?.prompt || '', edit: prompt, parent: { url: source, meta: sourceMeta } });
    log('Immagine modificata ✔ · «⇆ Prima / dopo» per confrontarla');
  } catch(e){ log('Errore refine: '+e.message); }
  busy(false);
};

/* Modifiche rapide: scrivono l'istruzione nel campo, che resta modificabile */
$('#quickEdit').onchange = e => {
  const v = e.target.value; e.target.value = '';
  if (!v) return;
  let text = v;
  if (v === '__style') {
    const s = $('#style').value;
    if (!s) return log('Scegli prima uno stile nel menu «Stile artistico».');
    text = `Applica questo stile mantenendo soggetto e composizione: ${STYLES[s]}`;
  } else if (v === '__mystyle') {
    if (!styleState.text.trim()) return log('Il profilo di stile è vuoto: aggiornalo nella sezione «Il mio stile».');
    text = 'Riporta l\'immagine al mio stile, mantenendo soggetto e composizione';
  } else if (v === '__remove') text = 'Togli ';
  const input = $('#refineTxt');
  input.value = text; input.focus(); input.setSelectionRange(text.length, text.length);
};

/* ── Confronto prima/dopo ── */
let compareObserver = null;

function setCompare(on){
  const parent = lastMeta?.parent;
  on = Boolean(on && parent);
  $('#btnCompare').classList.toggle('on', on); $('#btnCompare').setAttribute('aria-pressed', String(on));
  $('#compareRange').classList.toggle('hidden', !on);
  compareObserver?.disconnect(); compareObserver = null;
  $('#stage .compare-overlay')?.remove();
  if (!on) return;
  const img = $('#stage img');
  const ov = document.createElement('div'); ov.className = 'compare-overlay';
  const before = document.createElement('div'); before.className = 'compare-before';
  before.style.backgroundImage = `url("${String(parent.url).replace(/"/g, '%22')}")`;
  const line = document.createElement('div'); line.className = 'compare-line';
  const t1 = document.createElement('span'); t1.className = 'compare-tag before'; t1.textContent = 'Prima';
  const t2 = document.createElement('span'); t2.className = 'compare-tag after'; t2.textContent = 'Dopo';
  ov.append(before, line, t1, t2);
  $('#stage').append(ov);
  const place = () => {
    ov.style.left = img.offsetLeft + 'px'; ov.style.top = img.offsetTop + 'px';
    ov.style.width = img.clientWidth + 'px'; ov.style.height = img.clientHeight + 'px';
  };
  const setPos = (pct) => {
    pct = Math.max(0, Math.min(100, pct));
    before.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    line.style.left = pct + '%';
    $('#compareRange').value = String(Math.round(pct));
  };
  const fromPointer = (e) => { const r = ov.getBoundingClientRect(); setPos((e.clientX - r.left) / r.width * 100); };
  ov.onpointerdown = (e) => { ov.setPointerCapture(e.pointerId); fromPointer(e); };
  ov.onpointermove = (e) => { if (ov.hasPointerCapture(e.pointerId)) fromPointer(e); };
  $('#compareRange').oninput = (e) => setPos(Number(e.target.value));
  compareObserver = new ResizeObserver(place); compareObserver.observe(img); compareObserver.observe($('#stage'));
  place(); setPos(50);
}

function updateCompareButtons(){
  const has = Boolean(lastMeta?.parent);
  $('#btnCompare').disabled = $('#btnPrev').disabled = !has;
  setCompare(false);
}

/* ── Nuovo formato (outpainting) ──
   L'immagine intera va al centro di una tela del formato di arrivo; lo spazio che manca è riempito con una
   versione molto sfocata dell'immagine stessa (dà al modello colori e luce da continuare). Il modello allarga
   la scena in quello spazio. Se il risultato non ha il formato esatto, si ritaglia al centro. */
const parseRatio = (s) => { const [a, b] = String(s).split(':').map(Number); return a > 0 && b > 0 ? a / b : NaN; };
const REFORMAT_MAX_SIDE = 2048;

function paddedCanvas(img, r){
  const w = img.naturalWidth, h = img.naturalHeight;
  let W = r > w / h ? h * r : w, H = r > w / h ? h : w / r;
  const k = Math.min(1, REFORMAT_MAX_SIDE / Math.max(W, H));
  W = Math.round(W * k); H = Math.round(H * k);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  // sfocatura senza ctx.filter: l'immagine «a copertura» rimpicciolita a pochi pixel e poi riallargata
  const t = document.createElement('canvas'), ts = 24 / Math.max(W, H);
  t.width = Math.max(1, Math.round(W * ts)); t.height = Math.max(1, Math.round(H * ts));
  const cover = Math.max(t.width / w, t.height / h);
  t.getContext('2d').drawImage(img, (t.width - w * cover) / 2, (t.height - h * cover) / 2, w * cover, h * cover);
  g.imageSmoothingQuality = 'high';
  g.drawImage(t, 0, 0, W, H);
  const dw = Math.round(w * k), dh = Math.round(h * k);
  g.drawImage(img, Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh);
  return c;
}

/* Ritaglio centrale al formato esatto, solo se il modello ha restituito proporzioni diverse */
async function enforceRatio(url, r){
  const img = await maskLoadImage(url);
  const w = img.naturalWidth, h = img.naturalHeight;
  if (Math.abs((w / h) / r - 1) <= 0.02) return { url, cropped: false };
  const cw = w / h > r ? Math.round(h * r) : w, ch = w / h > r ? h : Math.round(w / r);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  c.getContext('2d').drawImage(img, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw, ch);
  return { url: c.toDataURL('image/png'), cropped: true, from: `${w}×${h}` };
}

$('#btnReformat').onclick = async () => {
  if (!lastImage) return;
  const target = $('#reformatRatio').value, r = parseRatio(target);
  const source = lastImage, sourceMeta = lastMeta;
  busy(true);
  try {
    let img;
    try { img = await maskLoadImage(source); }
    catch { throw new Error('immagine non leggibile qui (forse è su un sito esterno): scaricala e riaprila con «Carica immagine»'); }
    const src = img.naturalWidth / img.naturalHeight;
    if (Math.abs(src / r - 1) <= 0.02) { log(`L'immagine è già in formato ${target}.`); busy(false); return; }
    const wider = r > src;
    const padded = paddedCanvas(img, r).toDataURL('image/jpeg', 0.92);
    const prompt = `This picture is placed in the center of a ${wider ? 'wider' : 'taller'} ${target} canvas; the blurred areas on the ${wider ? 'left and right' : 'top and bottom'} are only placeholders. `
      + `Extend the scene into those areas so the result is one seamless ${target} image: continue the environment, perspective, light, colors and texture naturally, with no visible seams. `
      + `Keep the original central part exactly as it is: same subject, composition, faces and any text. Do not add new main subjects, borders, frames or text in the extended areas.`
      + (sourceMeta?.prompt ? ` The scene was originally described as: ${sourceMeta.prompt}` : '');
    log(`Allargo la scena al formato ${target} (${wider ? 'ai lati' : 'sopra e sotto'})…`);
    const res = await orFetch('/api/generate', { model: $('#imageModel').value, prompt, referenceImages: [padded] });
    const out = await enforceRatio(res.images[0], r).catch(() => ({ url: res.images[0], cropped: false }));
    if (out.cropped) log(`Il modello ha restituito ${out.from}: ritaglio al centro per avere esattamente ${target}.`);
    showImage(out.url, { prompt: sourceMeta?.prompt || '', edit: prompt, ratio: target, parent: { url: source, meta: sourceMeta } });
    log(`Formato ${target} pronto ✔ · «⇆ Prima / dopo» mostra l'originale dentro la nuova inquadratura`);
  } catch (e) { log('Nuovo formato: ' + e.message); }
  busy(false);
};

$('#btnCompare').onclick = () => setCompare(!$('#btnCompare').classList.contains('on'));
$('#btnPrev').onclick = () => {
  const p = lastMeta?.parent; if (!p) return;
  renderImage(p.url, p.meta || { prompt: '' });
  log('Tornato alla versione precedente (quella modificata resta nella galleria).');
};

/* ── Esportazione ── */
function saveBlob(blob, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);   // subito dopo il click alcuni browser annullerebbero il download
}

async function downloadAs(url, format){
  const ext = format === 'jpeg' ? 'jpg' : format;
  if (maskEnabled && maskBlocks.length) {
    saveBlob(await compositeMask(url, format), `coverforge-mask-${cat}-${Date.now()}.${ext}`);
    return;
  }
  const img = await maskLoadImage(url);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const quality = format === 'png' ? undefined : 0.85;
  const blob = await new Promise(r=>c.toBlob(r, mime, quality));
  saveBlob(blob, `coverforge-${cat}-${Date.now()}.${ext}`);
}
$('#btnDl').onclick = async () => {
  if (!lastImage) return;
  try { await downloadAs(lastImage, $('#dlFormat').value); }
  catch(e){ log('Download fallito: ' + e.message); }
};

/* Vettorizzazione locale (trace.js): nessuna immagine esce dal computer */
$('#btnSvg').onclick = async () => {
  if (!lastImage) return;
  const n = Number($('#svgColors').value) || 8;
  const btn = $('#btnSvg'); btn.disabled = true;
  log(`Vettorializzo in locale con ${n} colori…`);
  try {
    const t0 = performance.now();
    const svg = await traceToSvg(lastImage, { colors: n });
    saveBlob(new Blob([svg], {type:'image/svg+xml'}), `coverforge-${cat}-${Date.now()}.svg`);
    log(`SVG pronto: ${Math.round(svg.length / 1024)} KB in ${((performance.now() - t0) / 1000).toFixed(1)} s. Dà il meglio con loghi e icone a colori piatti.`);
  } catch(e){ log('Vettorializzazione fallita: ' + e.message); }
  btn.disabled = false;
};

/* ── Cronologia ── */
async function loadHistory(){
  if (MODE !== 'proxy') { $('#history').innerHTML = '<div class="placeholder">Solo con proxy server</div>'; return; }
  try {
    const r0 = await fetch('/api/history');
    if (!r0.ok) throw new Error(r0.status);
    const rows = await r0.json();
    const h = $('#history'); h.innerHTML = '';
    if (!rows.length) { h.innerHTML = '<div class="placeholder">Nessun progetto salvato</div>'; return; }
    rows.forEach(row => {
      const d = document.createElement('div'); d.className='hist-item';
      if (row.image_url) {
        const im = document.createElement('img');
        im.loading = 'lazy'; im.decoding = 'async'; im.alt = ''; im.src = row.image_url;
        d.append(im);
      }
      const meta = document.createElement('div'); meta.className = 'meta';
      const cat = document.createElement('b'); cat.textContent = row.category;
      meta.append(cat,
        document.createTextNode(` · ${row.ratio||''}${row.style ? ' · ' + row.style : ''}`),
        document.createElement('br'),
        document.createTextNode(row.brief || row.prompt || ''));
      meta.onclick = () => restoreRow(row);
      activatable(meta, `Ripristina: ${row.category} ${row.ratio || ''} ${(row.brief || row.prompt || '').slice(0, 60)}`.trim());
      const fav = document.createElement('button');
      fav.className = 'fav' + (row.favorite ? ' on' : ''); fav.textContent = '⭐';
      fav.title = 'Preferita: entra nell\'archivio del tuo stile'; fav.setAttribute('aria-label', 'Preferita');
      fav.setAttribute('aria-pressed', String(Boolean(row.favorite)));
      fav.onclick = (e) => { e.stopPropagation(); toggleMark(fav, `/api/history/${row.id}/favorite`, 'favorite', row.id); };
      const del = document.createElement('button');
      del.textContent = '✕'; del.title = 'Elimina'; del.setAttribute('aria-label', 'Elimina dalla cronologia');
      del.onclick = async (e) => {
        e.stopPropagation();
        await fetch('/api/history/'+row.id, {method:'DELETE'});
        loadHistory(); loadStyle();
      };
      d.append(meta, fav, del);
      h.appendChild(d);
    });
  } catch(e){ log('Cronologia: '+e.message); }
}
function restoreRow(row){
  cat = row.category;
  document.querySelectorAll('.cat').forEach(x=>x.classList.toggle('on', x.dataset.k===row.category));
  fillRatios(); $('#ratio').value = row.ratio || CATS[cat].ratios[0];
  $('#style').value = row.style || '';
  $('#brief').value = row.brief || '';
  $('#promptOut').value = row.prompt || '';
  if (row.image_url) renderImage(row.image_url, { prompt: row.prompt, historyId: row.id, favorite: Boolean(row.favorite) });   // niente nuovo salvataggio
  log('Ripristinato dalla cronologia');
}
$('#btnHistReload').onclick = loadHistory;
$('#btnHistClear').onclick = async () => {
  if (!confirm('Svuotare tutta la cronologia?')) return;
  await fetch('/api/history', {method:'DELETE'});
  loadHistory(); loadStyle();
};

/* ── Il mio stile ──
   Archivio: ⭐ in cronologia e 🎨 sulle immagini allegate. «Aggiorna profilo» manda le immagini, ridotte,
   a un modello con la vista che ne scrive una descrizione; a ogni prompt viaggia solo quel testo. */
let styleState = { text: '', ts: null, sources: [], archive: { images: [], examples: 0, favorites: 0 } };

async function loadStyle(){
  if (MODE !== 'proxy') { $('#styleStatus').textContent = 'Il profilo di stile richiede il server locale.'; return; }
  const r = await fetch('/api/style-profile');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  styleState = await r.json();
  if (!$('#btnStyleSave').disabled) return renderStyleStatus();   // modifiche non salvate: non sovrascriverle
  $('#styleProfile').value = styleState.text || '';
  renderStyleStatus();
}

function renderStyleStatus(){
  const a = styleState.archive, n = a.examples + a.favorites;
  const el = $('#styleStatus'); el.replaceChildren();
  el.append(`Archivio: ${a.favorites} preferite ⭐ · ${a.examples} esempi 🎨`);
  if (styleState.ts) el.append(` · profilo del ${new Date(styleState.ts).toLocaleDateString('it-IT')}${styleState.auto ? '' : ' (scritto a mano)'}`);
  const used = new Set(styleState.sources || []), now = a.images.map(i => i.key);
  let warn = '';
  if (n < 3) warn = `Servono almeno 3 immagini per ricavare il profilo (ne mancano ${3 - n}).`;
  else if (styleState.auto && (now.length !== used.size || now.some(k => !used.has(k)))) warn = 'L\'archivio è cambiato dall\'ultimo profilo: puoi aggiornarlo.';
  if (warn) { const w = document.createElement('div'); w.className = 'warn'; w.textContent = warn; el.append(w); }
}

/* Immagini dell'archivio da allegare al generatore come riferimento di stile (punto «Allega al generatore»).
   Le prime dell'archivio (le più recenti, alternando esempi e preferite), escluse quelle già allegate come riferimento.
   Non per logo e icona: lì contano semplicità e forma, e un'immagine ricca spingerebbe il generatore fuori strada. */
const STYLE_REFS_MAX = 2;
function styleRefImages(already = []){
  if (!$('#styleRefs').checked || MODE !== 'proxy') return [];
  if (cat === 'logo' || cat === 'icona') { log('Riferimenti di stile non allegati: per logo e icona si usa solo il profilo.'); return []; }
  const urls = styleState.archive.images.map(i => i.url).filter(u => !already.includes(u)).slice(0, STYLE_REFS_MAX);
  if (!urls.length) log('⚠ «Allega al generatore» è attivo ma l\'archivio di stile è vuoto: proseguo senza.');
  else log(`Allego ${urls.length} ${urls.length === 1 ? 'immagine' : 'immagini'} dell'archivio come riferimento di stile.`);
  return urls;
}
const styleRefsSentence = (n) => n === 1
  ? 'The last attached image is a style reference only: borrow its rendering technique, color palette, lighting and texture, not its subject or composition.'
  : `The last ${n} attached images are style references only: borrow their rendering technique, color palette, lighting and texture, not their subjects or composition.`;

/* ⭐ / 🎨: aggiorna subito il pulsante, poi il server; in caso di errore torna indietro */
async function toggleMark(btn, url, field, historyId){
  const on = !btn.classList.contains('on');
  btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on));
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: on }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    if (historyId != null && historyId === lastHistoryId) { setFavButton(on); if (lastMeta) lastMeta.favorite = on; }
    await loadStyle();
  } catch (e) {
    btn.classList.toggle('on', !on); btn.setAttribute('aria-pressed', String(!on));
    log('Archivio di stile: ' + e.message);
  }
}

function setFavButton(on){
  const b = $('#btnFav');
  b.disabled = lastHistoryId == null;
  b.classList.toggle('on', Boolean(on)); b.setAttribute('aria-pressed', String(Boolean(on)));
  b.textContent = on ? '⭐ Preferita' : '☆ Preferita';
}

$('#btnFav').onclick = async () => {
  if (lastHistoryId == null) return;
  const btn = $('#btnFav'), on = !btn.classList.contains('on');
  try {
    const r = await fetch(`/api/history/${lastHistoryId}/favorite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: on }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    setFavButton(on); if (lastMeta) lastMeta.favorite = on;
    log(on ? '⭐ Aggiunta alle preferite (archivio del tuo stile).' : 'Tolta dalle preferite.');
    await Promise.all([loadHistory(), loadStyle()]);
  } catch (e) { log('Preferita: ' + e.message); }
};

$('#styleProfile').oninput = () => { $('#btnStyleSave').disabled = false; };
$('#btnStyleSave').onclick = async () => {
  try {
    const r = await fetch('/api/style-profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: $('#styleProfile').value }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
    $('#btnStyleSave').disabled = true;
    log('Profilo di stile salvato.');
    await loadStyle();
  } catch (e) { log('Profilo non salvato: ' + e.message); }
};

$('#btnStyleBuild').onclick = async () => {
  if (MODE !== 'proxy') return log('Il profilo di stile richiede il server locale.');
  const imgs = styleState.archive.images;
  if (imgs.length < 3) return log(`Profilo di stile: segna almeno 3 immagini (⭐ in cronologia o 🎨 tra gli allegati); ora sono ${imgs.length}.`);
  if (!textModelSeesImages()) return log('Profilo di stile: il modello LLM scelto non vede le immagini. Scegline uno segnato con 👁.');
  if (!$('#btnStyleSave').disabled && !confirm('Il profilo ha modifiche non salvate: aggiornarlo le sostituisce. Continuare?')) return;
  const btn = $('#btnStyleBuild'); btn.disabled = true;
  busy(true); log(`Analizzo ${imgs.length} immagini per il profilo di stile…`);
  try {
    const images = [], sources = [];
    for (const i of imgs) {
      try { images.push(await downscaleJpeg(i.url, 512)); sources.push(i.key); }
      catch { log(`⚠ Immagine dell'archivio non leggibile (${i.kind}): saltata.`); }
    }
    if (images.length < 3) throw new Error('meno di 3 immagini leggibili');
    const r = await orFetch('/api/style-profile/build', { model: $('#textModel').value, images, sources });
    $('#btnStyleSave').disabled = true;
    await loadStyle();
    log(`🖌️ Profilo di stile aggiornato da ${images.length} immagini. Controllalo e, se serve, correggilo.`);
    if (!r.text) log('⚠ Il profilo è vuoto.');
  } catch (e) { log('Profilo di stile: ' + e.message); }
  busy(false); btn.disabled = false;
};

/* Un'immagine non generata qui (allegato o file dal computer) nel riquadro del risultato:
   si può rifinire, comporre con la mascherina, esportare. Non entra in cronologia finché non la rifinisci. */
function openOnStage(url, name){
  const meta = { prompt: '' };
  renderImage(url, meta);
  addToGallery(url, meta);
  $('#stage').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  log(`Aperta: ${name}. Puoi rifinirla, aggiungere testo con la mascherina o esportarla.`);
}

$('#btnOpenImg').onclick = () => $('#openImgInput').click();
$('#openImgInput').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) maskUseOwnImage(f); };

/* ── Utility ── */
/* Una nuova immagine generata: mostra, aggiungi alla galleria, salva in cronologia */
function showImage(url, meta){
  renderImage(url, meta);
  addToGallery(url, meta);
  saveToHistory(url, meta);
}

/* Solo visualizzazione (usata anche da galleria e ripristino, senza salvare) */
function renderImage(url, meta){
  lastImage = url; lastMeta = meta;
  lastHistoryId = meta?.historyId ?? null;
  setFavButton(meta?.favorite);
  const img = new Image(); img.alt = 'risultato'; img.src = url;   // niente HTML interpolato
  $('#stage').replaceChildren(img);
  updateCompareButtons();
  watchStage(img);

  // Show mask panel
  $('#maskPanel').classList.remove('hidden');
  maskEnableDownloads();

  if (!maskBlocks.length) {
    // auto-apply preset based on category
    const presetMap = { libro:'book-cover', album:'album', logo:'logo', icona:'custom', header:'header', blog:'blog' };
    const pid = presetMap[cat] || 'custom';
    setTimeout(() => {
      applyMaskPreset(pid, { silent: true });
      $('#maskPreset').value = pid;
      maskEnabled = false;
      $('#maskToggle').checked = false;
      renderOverlay();
    }, 10);
  } else {
    renderOverlay();   // la mascherina attiva deve comparire anche sulle immagini successive
  }

  $('#btnDl').disabled = $('#btnRefine').disabled = $('#btnSvg').disabled = $('#btnReformat').disabled = false;
}

function addToGallery(url, meta){
  const im = new Image(); im.src = url; im.alt = 'variante della sessione';
  im.onclick = () => renderImage(url, meta);
  activatable(im, 'Mostra questa variante');
  $('#gallery').prepend(im);
}

async function saveToHistory(url, meta){
  if (MODE !== 'proxy') return;
  try {
    const r = await fetch('/api/history', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        category: cat, ratio: meta?.ratio || $('#ratio').value, style: $('#style').value,
        title: $('#titleTxt').value, subtitle: $('#subTxt').value,
        brief: $('#brief').value, prompt: $('#promptOut').value, image: url,
        text_model: $('#textModel').value, image_model: $('#imageModel').value
      })});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    if (meta) meta.historyId = j.id;   // anche la galleria della sessione ritrova la riga
    if (lastMeta === meta) { lastHistoryId = j.id; setFavButton(false); }
    await loadHistory();
  } catch(e){ log('Cronologia non salvata: ' + e.message); }
}

$('#btnClear').onclick = () => { $('#brief').value=''; $('#promptOut').value=''; $('#ideasBox').classList.add('hidden'); };

function busy(b){
  ['btnGo','btnIdeas','btnGen','btnRe','btnRefine','btnApprove','btnAnother'].forEach(id=>$('#'+id).disabled=b);
  $('#btnReformat').disabled = b || !lastImage;
  $('#btnCancel').classList.toggle('hidden', !b);
  if (b) { if (!activeAbort) activeAbort = new AbortController(); }   // craft() → generate() condividono lo stesso
  else activeAbort = null;
}
$('#btnCancel').onclick = () => activeAbort?.abort();
function log(t){ $('#log').textContent = `[${new Date().toLocaleTimeString()}] ${t}\n` + $('#log').textContent; }

/* ── Init upload ── */
setupFileUpload();