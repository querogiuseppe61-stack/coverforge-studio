/* Modifica dell'immagine: Rifinisci (con l'LLM e modifiche rapide), zona segnata, confronto prima/dopo,
   nuovo formato con la scena allargata. */

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

/* att: { zone, marked, extras } — zona segnata (marked = immagine con la zona in rosso) e immagini di materiale */
async function craftEditPrompt(instr, source, sourceMeta, att = {}){
  const profile = ($('#useStyle').checked || wantsMyStyle(instr)) && MODE === 'proxy' ? styleState.text.trim() : '';
  if (wantsMyStyle(instr) && !profile) log('⚠ Hai chiesto «il mio stile» ma il profilo di stile è vuoto.');
  let parts = [], seenExtras = 0;
  if (textModelSeesImages()) {
    try { parts = [{ type: 'image_url', image_url: { url: await downscaleJpeg(att.marked || source, 768) } }]; }
    catch { log('⚠ Il modello di testo non può vedere questa immagine: preparo l\'istruzione senza.'); }
    for (const u of (parts.length ? att.extras || [] : []).slice(0, 2)) {
      try { parts.push({ type: 'image_url', image_url: { url: await downscaleJpeg(u, 512) } }); seenExtras++; } catch {}
    }
  }
  const zoneNote = att.zone
    ? `\nL'utente ha segnato in rosso la zona da modificare${parts.length ? " (la vedi nell'immagine allegata)" : ''}: la modifica riguarda solo quella zona.${parts.length ? ' Nomina nell\'istruzione che cosa c\'è in quella zona, così il generatore la individua.' : ''}` : '';
  const extrasNote = att.extras?.length
    ? `\nAl generatore arrivano anche ${att.extras.length} immagini di materiale scelte dall'utente${seenExtras ? ` (le vedi dopo la prima: ${seenExtras})` : ' (non le vedi)'}: la richiesta può riferirsi a loro («questo oggetto», «questa palette»).` : '';
  const guide = await editGuide();
  const system = `Sei un fotoritoccatore e prompt engineer. L'utente vuole modificare un'immagine esistente con un modello grafico conversazionale, che riceve l'immagine e un'istruzione in inglese e rigenera l'immagine seguendola.
Tipo di progetto: ${CATS[cat].hint}.${sourceMeta?.prompt ? `\nPrompt con cui l'immagine era stata creata: ${sourceMeta.prompt}` : ''}
${parts.length ? "L'immagine da modificare è allegata al messaggio: guardala e nomina gli elementi da conservare con le loro caratteristiche visibili." : "Non vedi l'immagine: non inventarne il contenuto e riferisciti agli elementi in modo generico."}${zoneNote}${extrasNote}${att.zone || att.extras?.length ? "\nNon descrivere gli allegati né il segno rosso: le frasi su zona e allegati le aggiunge l'app." : ''}${profile ? `\n\n=== STILE PREFERITO DELL'UTENTE ===\n${profile}\n=== FINE STILE ===\nSe la richiesta riguarda lo stile o «il mio stile», porta tecnica, palette, luce e texture verso questo profilo.` : ''}

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
    const extras = $('#refineRefs').checked ? getSelectedImageUrls().filter(u => u !== source).slice(0, 2) : [];
    if ($('#refineRefs').checked && !extras.length) log('⚠ «Usa nella modifica le immagini spuntate» è attivo ma nei Riferimenti non c\'è nessuna immagine spuntata.');
    const marked = zoneHasPaint() ? await markedImage(source) : null;
    const att = { zone: Boolean(marked), marked, extras };
    let prompt;
    if ($('#refineLLM').checked) {
      log('L\'LLM prepara l\'istruzione di modifica…');
      const j = await craftEditPrompt(instr, source, sourceMeta, att);
      prompt = j.prompt.trim();
      log(`✎ Cambia: ${String(j.cambia ?? '').trim() || '—'} · Resta: ${String(j.conserva ?? '').trim() || '—'}`);
    } else {
      prompt = `Edit this image: ${instr}. Keep overall composition and style.`;
      if (wantsMyStyle(instr) && styleState.text.trim()) prompt += `\nTarget style (described in Italian): ${styleState.text.trim()}`;
    }
    // ordine degli allegati: immagine da modificare, [immagine con la zona], [materiale]; le frasi lo descrivono
    const refs = [source];
    if (marked) {
      refs.push(marked);
      prompt += '\n\nThe first attached image is the one to edit. The second attached image is the same picture with the area to change tinted and outlined in red: apply the change only inside that area, blend it seamlessly, and keep everything outside it identical. Do not reproduce the red tint or outline.';
    }
    if (extras.length) {
      refs.push(...extras);
      prompt += `\n\nThe last ${extras.length === 1 ? 'attached image is' : `${extras.length} attached images are`} material for this edit (an object, a character or a palette the instruction refers to): use ${extras.length === 1 ? 'it' : 'them'} as the instruction says, without copying ${extras.length === 1 ? 'its' : 'their'} background.`;
    }
    if (marked || extras.length) log(`Allegati alla modifica: ${[marked ? 'zona segnata' : '', extras.length ? `${extras.length} immagini di materiale` : ''].filter(Boolean).join(' · ')}`);
    log('Rifinisco…');
    // la modifica deve conservare le proporzioni: si chiede il formato dell'immagine di partenza, se è tra quelli ammessi
    const dims = await maskLoadImage(source).then(i => [i.naturalWidth, i.naturalHeight]).catch(() => []);
    const aspect = aspectForSize(...dims);
    const r = await orFetch('/api/generate', { model: $('#imageModel').value, prompt, referenceImages: refs, aspectRatio: aspect });
    if (aspect) noteAspect(r, aspect);
    // il prompt d'origine segue la catena delle modifiche; parent permette confronto e ritorno
    showImage(r.images[0], { prompt: sourceMeta?.prompt || '', edit: prompt, ratio: sourceMeta?.ratio, parent: { url: source, meta: sourceMeta } });
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

/* ── Zona da modificare ──
   Una tela grande come l'immagine (lato massimo 2048 px) sopra il risultato: si dipinge in rosso la parte
   da cambiare. Alla rifinitura il generatore riceve l'originale e una copia con la zona in rosso. */
let zone = null;   // { canvas, observer, painted }

function zoneHasPaint(){ return Boolean(zone?.painted); }

function resetZone(){
  zone?.observer.disconnect(); zone?.canvas.remove(); zone = null;
  setZoneMode(false);
  $('#btnZone').disabled = !lastImage;
}

function ensureZone(){
  if (zone) return zone;
  const img = $('#stage img'); if (!img || !img.naturalWidth) return null;
  const k = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.className = 'zone-canvas';
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  $('#stage').append(c);
  const place = () => {
    c.style.left = img.offsetLeft + 'px'; c.style.top = img.offsetTop + 'px';
    c.style.width = img.clientWidth + 'px'; c.style.height = img.clientHeight + 'px';
  };
  const observer = new ResizeObserver(place); observer.observe(img); observer.observe($('#stage')); place();
  const g = c.getContext('2d'); g.lineCap = g.lineJoin = 'round'; g.strokeStyle = '#ff2828';
  let last = null;
  const pt = (e) => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height, s: c.width / r.width }; };
  const dot = (p) => { g.lineWidth = Number($('#zoneBrush').value) * p.s; g.beginPath(); g.moveTo((last || p).x, (last || p).y); g.lineTo(p.x, p.y); g.stroke(); last = p; zone.painted = true; $('#btnZoneClear').disabled = false; };
  c.onpointerdown = (e) => { c.setPointerCapture(e.pointerId); last = null; dot(pt(e)); };
  c.onpointermove = (e) => { if (c.hasPointerCapture(e.pointerId)) dot(pt(e)); };
  c.onpointerup = () => { last = null; };
  zone = { canvas: c, observer, painted: false };
  return zone;
}

function setZoneMode(on){
  if (on && !ensureZone()) return log('Apri prima un\'immagine nel riquadro del risultato.');
  if (on) setCompare(false);
  zone?.canvas.classList.toggle('drawing', on);
  $('#btnZone').classList.toggle('on', on); $('#btnZone').setAttribute('aria-pressed', String(on));
  $('#btnZone').textContent = on ? '✓ Fatto' : '🖌 Segna la zona';
  $('#zoneBrushWrap').classList.toggle('hidden', !on);
  $('#btnZoneClear').classList.toggle('hidden', !zoneHasPaint() && !on);
  $('#btnZoneClear').disabled = !zoneHasPaint();
}

/* L'originale con la zona velata di rosso e un contorno rosso pieno, che resta leggibile anche su fondi
   caldi (JPEG, lato massimo 2048 px). Contorno = zona dilatata meno la zona. */
async function markedImage(source){
  // le immagini su siti esterni (vecchie voci della cronologia) non si possono ridisegnare su una tela
  const img = await maskLoadImage(source).catch(() => { throw new Error('questa immagine non si può segnare qui (è su un sito esterno): scaricala e riaprila con «Carica immagine»'); });
  const z = zone.canvas, W = z.width, H = z.height;
  const ring = document.createElement('canvas'); ring.width = W; ring.height = H;
  const rg = ring.getContext('2d'), rad = Math.max(3, Math.round(Math.max(W, H) / 200));
  for (let a = 0; a < 16; a++) rg.drawImage(z, Math.round(Math.cos(a * Math.PI / 8) * rad), Math.round(Math.sin(a * Math.PI / 8) * rad));
  rg.globalCompositeOperation = 'destination-out'; rg.drawImage(z, 0, 0);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, W, H);
  g.globalAlpha = 0.45; g.drawImage(z, 0, 0);
  g.globalAlpha = 1; g.drawImage(ring, 0, 0);
  return c.toDataURL('image/jpeg', 0.9);
}

$('#btnZone').onclick = () => {
  const on = !$('#btnZone').classList.contains('on');
  setZoneMode(on);
  if (on) log('🖌 Dipingi la zona da modificare, poi scrivi la modifica e premi Rifinisci.');
};
$('#btnZoneClear').onclick = () => {
  if (!zone) return;
  zone.canvas.getContext('2d').clearRect(0, 0, zone.canvas.width, zone.canvas.height);
  zone.painted = false; setZoneMode($('#btnZone').classList.contains('on'));
};

/* ── Confronto prima/dopo ── */
let compareObserver = null;

function setCompare(on){
  const parent = lastMeta?.parent;
  on = Boolean(on && parent);
  if (on && $('#btnZone').classList.contains('on')) setZoneMode(false);
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
    const res = await orFetch('/api/generate', { model: $('#imageModel').value, prompt, referenceImages: [padded], aspectRatio: aspectFor(target) });
    noteAspect(res, target);
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
