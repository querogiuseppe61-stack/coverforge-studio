/* CoverForge Studio · base comune: costanti, preferenze ricordate, chiamate a OpenRouter (server locale
   o modalità diretta), stato «occupato», registro. Gli script di public/js/ sono script classici che condividono
   lo stesso ambito globale e si caricano in quest'ordine: core, connection, refs, prompt, edit, result, style, main
   (dopo mask.js e trace.js). Al caricamento ognuno dichiara funzioni e collega i propri pulsanti;
   l'avvio vero e proprio sta in main.js, che viene per ultimo. */

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
      accountCost(route, j);
      return j;
    }
    const url = route.replace(/^\/api\/models/,`${OR_DIRECT}/models`).replace(/^\/api\/(craft|generate)/,`${OR_DIRECT}/chat/completions`);
    // senza server la richiesta di generazione va tradotta nel formato di OpenRouter (come fa /api/generate);
    // le immagini locali (/uploads, cronologia) qui non esistono: passano solo data URL e https
    const toOR = (withAspect) => route !== '/api/generate' ? body : {
      model: body.model, modalities: ['image', 'text'],
      messages: [{ role: 'user', content: [
        ...(body.referenceImages || []).filter(u => /^(data:image\/|https:\/\/)/.test(u)).map(u => ({ type: 'image_url', image_url: { url: u } })),
        { type: 'text', text: body.prompt }] }],
      ...(withAspect && body.aspectRatio ? { image_config: { aspect_ratio: body.aspectRatio } } : {})
    };
    const send = (withAspect) => fetch(url, { method, signal, headers:{'Authorization':`Bearer ${key()}`,'Content-Type':'application/json','HTTP-Referer':location.origin,'X-Title':'CoverForge Studio'}, body: body ? JSON.stringify(toOR(withAspect)) : undefined });
    let r = await send(true), aspectRejected = false;
    if (r.status === 400 && route === '/api/generate' && body.aspectRatio) { aspectRejected = true; r = await send(false); }
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
    const cost = typeof j.usage?.cost === 'number' ? j.usage.cost : null;
    if (route === '/api/craft') return accountCost(route, { content: msg.content, cost });
    const imgs = (msg.images||[]).map(i=>i.image_url?.url).filter(Boolean);
    if (!imgs.length) throw new Error('Nessuna immagine: scegli un modello grafico con output image');
    return accountCost(route, { images: imgs, cost, aspect: aspectRejected ? 'rifiutato' : body.aspectRatio ? 'inviato' : 'no' });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Operazione annullata.');
    if (e.name === 'TimeoutError') throw new Error('Tempo scaduto: nessuna risposta dal servizio.');
    if (e instanceof TypeError) throw new Error(MODE === 'proxy' ? 'Server locale non raggiungibile: è ancora in esecuzione?' : 'Connessione a OpenRouter non riuscita.');
    throw e;
  }
}

function typeIcon(type){
  const map = { image:'🖼️', txt:'📄', md:'📝', pdf:'📕', docx:'📘' };
  return map[type] || '📄';
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

function busy(b){
  ['btnGo','btnIdeas','btnGen','btnRe','btnRefine','btnApprove','btnAnother'].forEach(id=>$('#'+id).disabled=b);
  $('#btnReformat').disabled = b || !lastImage;
  $('#btnCancel').classList.toggle('hidden', !b);
  if (b) { if (!activeAbort) activeAbort = new AbortController(); }   // craft() → generate() condividono lo stesso
  else activeAbort = null;
}
$('#btnCancel').onclick = () => activeAbort?.abort();
function log(t){ $('#log').textContent = `[${new Date().toLocaleTimeString()}] ${t}\n` + $('#log').textContent; }
