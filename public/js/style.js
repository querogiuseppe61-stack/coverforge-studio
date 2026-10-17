/* Il mio stile: archivio (⭐ e 🎨), profilo ricavato dalle immagini, riferimenti di stile per il generatore. */

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
