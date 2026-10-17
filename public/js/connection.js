/* Connessione: verifica con OpenRouter, finestra di benvenuto, formati per tipo di progetto,
   elenco dei modelli e combinazioni consigliate, conteggio dei costi. */

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

/* ── Benvenuto ──
   Al primo avvio (e dal pulsante «Guida iniziale»): chiave OpenRouter, verifica, combinazione di modelli. */
let hasServerKey = false;

function renderWelcomeModels(){
  const box = $('#wModels');
  if (!modelList) { box.textContent = MODE === 'proxy' || key() ? 'Carico l\'elenco dei modelli…' : 'L\'elenco dei modelli arriva dopo aver inserito la chiave.'; return; }
  const rows = Object.entries(MODEL_PRESETS).map(([name, p], i) => {
    const r = resolvePreset(name);
    const lab = document.createElement('label');
    const inp = document.createElement('input'); inp.type = 'radio'; inp.name = 'wPreset'; inp.value = name; inp.checked = i === 0;
    inp.disabled = !r.text || !r.image;
    const txt = document.createElement('div');
    const b = document.createElement('b'); b.textContent = p.label;
    const sm = document.createElement('small');
    sm.textContent = r.text && r.image ? `testo: ${r.text} 👁 · immagini: ${r.image}` : 'nessun modello adatto disponibile ora';
    txt.append(b, ` · ${p.desc}`, sm);
    lab.append(inp, txt);
    return lab;
  });
  const keep = document.createElement('label');
  const ki = document.createElement('input'); ki.type = 'radio'; ki.name = 'wPreset'; ki.value = '';
  const kt = document.createElement('div'); kt.append(Object.assign(document.createElement('b'), { textContent: 'Scelgo io' }), ' · lascia i modelli selezionati ora nelle impostazioni');
  keep.append(ki, kt);
  box.replaceChildren(...rows, keep);
}

function openWelcome(){
  $('#wKey').value = $('#apiKey').value;
  $('#wRemember').checked = $('#rememberKey').checked;
  $('#wServerKey').classList.toggle('hidden', !hasServerKey);
  $('#wCheckResult').replaceChildren();
  renderWelcomeModels();
  const d = $('#welcome');
  if (!d.open) d.showModal();
}

function closeWelcome(apply){
  if (apply) {
    const name = document.querySelector('input[name="wPreset"]:checked')?.value;
    const r = name ? resolvePreset(name) : null;
    if (r?.text && r?.image) {
      $('#textModel').value = r.text; $('#imageModel').value = r.image;
      uiSet('textModel', r.text); uiSet('imageModel', r.image);
      log(`Modelli «${MODEL_PRESETS[name].label}»: ${r.text} per il testo, ${r.image} per le immagini.`);
    }
    uiSet('welcomeDone', true);
  }
  $('#welcome').close();
}

/* la chiave scritta qui è la stessa del campo nelle impostazioni */
$('#wKey').oninput = () => { $('#apiKey').value = $('#wKey').value.trim(); };
$('#wKey').onchange = () => $('#apiKey').onchange?.();
$('#wRemember').onchange = () => { $('#rememberKey').checked = $('#wRemember').checked; $('#rememberKey').onchange?.(); };
$('#wCheck').onclick = async () => {
  $('#apiKey').value = $('#wKey').value.trim(); $('#apiKey').onchange?.();
  $('#wCheckResult').textContent = 'Verifico…';
  await checkConnection();
  $('#wCheckResult').replaceChildren(...[...$('#checkResult').children].map(n => n.cloneNode(true)));
  if (!modelList) { await loadModels().catch(e => log('Modelli: ' + e.message)); }
};
$('#wDone').onclick = () => closeWelcome(true);
$('#wLater').onclick = () => closeWelcome(false);
$('#welcome').addEventListener('cancel', () => uiSet('welcomeDone', true));   // Esc: non riproporla a ogni avvio
$('#btnWelcome').onclick = openWelcome;
document.addEventListener('models-loaded', () => { if ($('#welcome').open) renderWelcomeModels(); });

function fillRatios(){
  const r = $('#ratio'); r.innerHTML = '';
  CATS[cat].ratios.forEach(x => r.add(new Option(x, x)));
  const saved = uiGet('ratio:' + cat);
  if (saved && CATS[cat].ratios.includes(saved)) r.value = saved;
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
  // predefiniti: i modelli della combinazione «Economica» presenti ora nell'elenco (niente id scritti nel codice che invecchiano)
  modelList = m;
  const eco = resolvePreset('economica', m);
  fill('#textModel',  m.text,  [eco.text]);
  fill('#imageModel', m.image, [eco.image]);
  log(`Pronto: ${m.text.length} testo, ${m.image.length} immagine.`);
  document.dispatchEvent(new Event('models-loaded'));
}

/* ── Combinazioni di modelli consigliate ──
   Ogni combinazione è un elenco di schemi in ordine di preferenza; per ogni schema si prende il modello
   più recente fra quelli disponibili (numero di versione più alto, a parità la versione non «preview»).
   Il modello di testo deve avere la vista (👁), che serve a guardare riferimenti e immagini da modificare. */
let modelList = null;
const MODEL_PRESETS = {
  economica: { label: 'Economica', desc: 'modelli veloci e a basso costo: per provare e per l\'uso di tutti i giorni',
    text: [/^google\/gemini-[\d.]+-flash$/, /^google\/gemini-[\d.]+-flash(?!.*(image|lite))/, /^openai\/gpt-[\d.o]+-mini$/, /^anthropic\/claude-.*haiku/],
    image: [/^google\/gemini-[\d.]+-flash-image/, /^google\/gemini-.*flash.*image/] },
  qualita: { label: 'Qualità', desc: 'i modelli più capaci: prompt più curati e immagini migliori, a un costo più alto',
    text: [/^anthropic\/claude-(sonnet|opus)-[\d.]+$/, /^anthropic\/claude-[\d.]+-(sonnet|opus)/, /^openai\/gpt-5(\.\d+)?$/, /^google\/gemini-[\d.]+-pro$/],
    image: [/^google\/gemini-[\d.]+-pro-image/, /^openai\/gpt-[\w.-]*image/, /^google\/gemini-.*image/] }
};
const modelVersion = (id) => parseFloat((/(\d+(?:\.\d+)?)/.exec(id.split('/')[1] || '') || [])[1]) || 0;
function pickModel(list, patterns, needVision){
  const pool = list.filter(x => !x.id.includes(':') && (!needVision || x.vision));
  for (const re of patterns) {
    const hits = pool.filter(x => re.test(x.id))
      .sort((a, b) => modelVersion(b.id) - modelVersion(a.id) || /preview/.test(a.id) - /preview/.test(b.id));
    if (hits.length) return hits[0].id;
  }
  return null;
}
function resolvePreset(name, m = modelList){
  const p = MODEL_PRESETS[name];
  if (!p || !m) return { text: null, image: null };
  return { text: pickModel(m.text, p.text, true), image: pickModel(m.image, p.image, false) };
}

/* ── Costi ──
   OpenRouter riporta in ogni risposta quanto ha addebitato (usage.cost, in crediti ≈ dollari).
   Totale della sessione nel badge 💳; il costo accumulato dall'ultima immagine (prompt, idee, generazione)
   si salva con l'immagine in cronologia. Il profilo di stile non si attribuisce a nessuna immagine. */
const COST_LABEL = { '/api/craft': 'testo', '/api/generate': 'immagine', '/api/style-profile/build': 'profilo di stile' };
const costState = { session: 0, pending: 0, pendingKnown: false, unknown: 0 };
const fmtCost = (n) => '$' + (n === 0 ? '0' : n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n.toFixed(2));

function accountCost(route, j){
  if (!COST_LABEL[route] || !j) return j;
  if (typeof j.cost === 'number') {
    costState.session += j.cost;
    if (route !== '/api/style-profile/build') { costState.pending += j.cost; costState.pendingKnown = true; }
    log(`💳 ${COST_LABEL[route]}: ${fmtCost(j.cost)} · sessione ${fmtCost(costState.session)}`);
  } else costState.unknown++;
  $('#costBadge').textContent = `💳 ${fmtCost(costState.session)}${costState.unknown ? ' +?' : ''}`;
  $('#costBadge').title = `Spesa su OpenRouter in questa sessione${costState.unknown ? ` (${costState.unknown} operazioni senza costo indicato da OpenRouter)` : ''}`;
  return j;
}
/* Costo da salvare con l'immagine appena arrivata, poi si riparte da zero */
function takePendingCost(){
  const c = costState.pendingKnown ? costState.pending : null;
  costState.pending = 0; costState.pendingKnown = false;
  return c;
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
