/* Riferimenti: file allegati (testi e immagini), selezione, estratti di testo e immagini ridotte per il modello. */

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
