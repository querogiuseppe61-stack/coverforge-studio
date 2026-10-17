/* Risultato: esportazione, cronologia (con versioni collegate), riquadro del risultato, galleria della sessione. */

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
    historyById = new Map(rows.map(r => [r.id, r]));
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
        document.createTextNode(` · ${row.ratio||''}${row.style ? ' · ' + row.style : ''}${row.parent_id ? ' · ✎ versione' : ''}${typeof row.cost === 'number' ? ' · ' + fmtCost(row.cost) : ''}`),
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
/* Versioni: una riga modificata punta alla riga di partenza (parent_id); il meta ricostruisce la catena,
   così «Prima / dopo» e «Versione precedente» funzionano anche nelle sessioni successive. */
let historyById = new Map();
function historyMeta(row, depth = 0){
  const parent = row.parent_id && depth < 20 ? historyById.get(row.parent_id) : null;
  return { prompt: row.prompt, historyId: row.id, favorite: Boolean(row.favorite), ratio: row.ratio,
    parent: parent?.image_url ? { url: parent.image_url, meta: historyMeta(parent, depth + 1) } : undefined };
}

function restoreRow(row){
  cat = row.category;
  document.querySelectorAll('.cat').forEach(x=>x.classList.toggle('on', x.dataset.k===row.category));
  fillRatios(); $('#ratio').value = row.ratio || CATS[cat].ratios[0];
  $('#style').value = row.style || '';
  $('#brief').value = row.brief || '';
  $('#promptOut').value = row.prompt || '';
  if (row.image_url) renderImage(row.image_url, historyMeta(row));   // niente nuovo salvataggio
  log('Ripristinato dalla cronologia');
}
$('#btnHistReload').onclick = loadHistory;
$('#btnHistClear').onclick = async () => {
  if (!confirm('Svuotare tutta la cronologia?')) return;
  await fetch('/api/history', {method:'DELETE'});
  loadHistory(); loadStyle();
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
  resetZone();
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
  const cost = takePendingCost();
  if (MODE !== 'proxy') return;
  try {
    const r = await fetch('/api/history', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        category: cat, ratio: meta?.ratio || $('#ratio').value, style: $('#style').value,
        title: $('#titleTxt').value, subtitle: $('#subTxt').value,
        brief: $('#brief').value, prompt: $('#promptOut').value, image: url,
        text_model: $('#textModel').value, image_model: $('#imageModel').value,
        parent_id: meta?.parent?.meta?.historyId ?? null,
        cost
      })});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    if (meta) meta.historyId = j.id;   // anche la galleria della sessione ritrova la riga
    if (lastMeta === meta) { lastHistoryId = j.id; setFavButton(false); }
    await loadHistory();
  } catch(e){ log('Cronologia non salvata: ' + e.message); }
}

$('#btnClear').onclick = () => { $('#brief').value=''; $('#promptOut').value=''; $('#ideasBox').classList.add('hidden'); };
