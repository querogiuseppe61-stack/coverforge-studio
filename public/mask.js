/* ═══════════════════════════════════════════════════
   M A S C H E R I N A  —  blocchi di testo sopra l'immagine
   Caricato PRIMA di app.js: qui solo dichiarazioni (usa $, log, lastImage, cat di app.js
   solo dentro le funzioni). app.js chiama initMask() all'avvio.
   ═══════════════════════════════════════════════════ */

/* ── Geometria condivisa tra anteprima (CSS), export PNG (canvas) ed export SVG ──
   Le dimensioni dei blocchi sono espresse su un'immagine larga MASK_REF_W px e scalate
   in proporzione (k = larghezza immagine / MASK_REF_W).
   X/Y sono percentuali dell'IMMAGINE: X è il punto di ancoraggio (inizio, centro o fine del testo
   secondo l'allineamento), Y il centro verticale del blocco. La rotazione è attorno al centro del blocco. */
const MASK_REF_W = 800;
const MASK_PAD_X = 18, MASK_PAD_Y = 8, MASK_RADIUS = 4;   // riquadro "Sfondo"
const MASK_MAX_BLOCKS = 30, MASK_MAX_TEXT = 500;
const MASK_WEIGHTS = [300, 400, 500, 600, 700, 800, 900];
// stessi font caricati da index.html (Google Fonts)
const MASK_FONTS = ['Inter', 'Anton', 'Bebas Neue', 'Cinzel', 'Dancing Script', 'JetBrains Mono', 'Lobster',
  'Merriweather', 'Oswald', 'Pacifico', 'Playfair Display', 'Space Grotesk'];
const MASK_PRESET_KEY = 'cf_mask_presets';
const MASK_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];
const MASK_STYLE_KEYS = ['font', 'weight', 'size', 'lineH', 'color', 'opacity', 'bg', 'shadow',
  'stroke', 'strokeW', 'strokeColor', 'glow', 'glowBlur', 'glowColor', 'grad', 'gradAngle', 'grad1', 'grad2'];

const MASK_DEFAULT = {
  text: '', x: 50, y: 50, size: 32, color: '#ffffff', weight: 600, align: 'center', opacity: 1, rotation: 0,
  bg: false, shadow: true, font: 'Inter', lineH: 1.2,
  stroke: false, strokeW: 4, strokeColor: '#000000',
  glow: false, glowBlur: 12, glowColor: '#7c5cff',
  grad: false, gradAngle: 90, grad1: '#7c5cff', grad2: '#22d3ee',
  group: null
};

const MASK_PRESETS = {
  'book-cover': { name:'📕 Copertina libro', blocks:[
    { text:'TITOLO',          x:50, y:30, size:38, color:'#ffffff', weight:700, align:'center', opacity:1, rotation:0, bg:false, shadow:true },
    { text:'SOTTOTITOLO',     x:50, y:44, size:18, color:'#d0d0d0', weight:400, align:'center', opacity:1, rotation:0, bg:false, shadow:true },
    { text:'NOME AUTORE',     x:50, y:80, size:15, color:'#ffffff', weight:500, align:'center', opacity:0.85, rotation:0, bg:false, shadow:true }
  ]},
  'album': { name:'💿 Album musicale', blocks:[
    { text:'ALBUM',    x:50, y:22, size:30, color:'#ffffff', weight:700, align:'center', opacity:1, rotation:0, bg:false, shadow:true },
    { text:'ARTISTA',  x:50, y:34, size:14, color:'#b0b0b0', weight:400, align:'center', opacity:0.9, rotation:0, bg:false, shadow:true }
  ]},
  'logo': { name:'✒️ Logo + tagline', blocks:[
    { text:'BRAND',          x:50, y:38, size:42, color:'#ffffff', weight:700, align:'center', opacity:1, rotation:0, bg:false, shadow:false },
    { text:'tagline',        x:50, y:52, size:13, color:'#aaaaaa', weight:400, align:'center', opacity:0.8, rotation:0, bg:false, shadow:false }
  ]},
  'header': { name:'🖥️ Header web', blocks:[
    { text:'Grande Titolo',               x:12, y:28, size:42, color:'#ffffff', weight:700, align:'left', opacity:1, rotation:0, bg:true, shadow:false },
    { text:'Sottotitolo descrittivo…',    x:12, y:44, size:18, color:'#cccccc', weight:400, align:'left', opacity:0.8, rotation:0, bg:true, shadow:false }
  ]},
  'blog': { name:'📰 Immagine articolo', blocks:[
    { text:'Titolo dell\'articolo',   x:8, y:74, size:36, color:'#ffffff', weight:700, align:'left', opacity:1, rotation:0, bg:true, shadow:false },
    { text:'Categoria · 5 min',        x:8, y:88, size:14, color:'#dddddd', weight:500, align:'left', opacity:0.9, rotation:0, bg:true, shadow:false }
  ]},
  'custom': { name:'✨ Personalizzata', blocks:[
    { text:'Il tuo testo',  x:50, y:50, size:32, color:'#ffffff', weight:600, align:'center', opacity:1, rotation:0, bg:false, shadow:true }
  ]}
};

/* ── Stato ── */
let maskBlocks = [];
let maskSel = new Set();      // id dei blocchi selezionati
let maskPrimary = null;       // id del blocco mostrato nei controlli
let maskEnabled = false;
let maskStyleClip = null;     // stile copiato
const maskUndo = [], maskRedo = [];
let maskLastKey = null, maskLastT = 0;
const maskEls = new Map();    // id → elemento dell'overlay
let maskDrag = null;

/* ── Utilità ── */
const maskRand = () => (Math.random().toString(36) + '000000').slice(2, 8);
const maskNewId = () => 'mb_' + maskRand();
const maskNewGroup = () => 'g_' + maskRand();
const maskById = id => maskBlocks.find(b => b.id === id) || null;
const maskPrimaryBlock = () => maskById(maskPrimary);
const maskSelectedBlocks = () => maskBlocks.filter(b => maskSel.has(b.id));
const maskClamp = (v, min, max, def) => { v = Number(v); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };
const maskHex = (v, def) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) ? v.toLowerCase() : def;
const maskFamily = blk => `'${blk.font}', sans-serif`;
const maskFmt = v => String(Math.round(v * 10) / 10);

function hexRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${a})`;
}

/* Tutto ciò che entra in un blocco (preset, JSON importato, controlli) passa da qui:
   i valori finiscono in stili CSS e in file SVG, quindi vanno validati. */
function normalizeBlock(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const d = MASK_DEFAULT;
  const weight = Math.round(Number(raw.weight) / 100) * 100;
  return {
    id: maskNewId(),
    text: typeof raw.text === 'string' ? raw.text.slice(0, MASK_MAX_TEXT) : d.text,
    x: maskClamp(raw.x, 0, 100, d.x),
    y: maskClamp(raw.y, 0, 100, d.y),
    size: maskClamp(raw.size, 8, 160, d.size),
    color: maskHex(raw.color, d.color),
    weight: MASK_WEIGHTS.includes(weight) ? weight : d.weight,
    align: ['left', 'center', 'right'].includes(raw.align) ? raw.align : d.align,
    opacity: maskClamp(raw.opacity, 0, 1, d.opacity),
    rotation: maskClamp(raw.rotation, -90, 90, d.rotation),
    bg: raw.bg === undefined ? d.bg : Boolean(raw.bg),
    shadow: raw.shadow === undefined ? d.shadow : Boolean(raw.shadow),
    font: MASK_FONTS.includes(raw.font) ? raw.font : d.font,
    lineH: maskClamp(raw.lineH, 0.8, 2.2, d.lineH),
    stroke: Boolean(raw.stroke),
    strokeW: maskClamp(raw.strokeW, 1, 20, d.strokeW),
    strokeColor: maskHex(raw.strokeColor, d.strokeColor),
    glow: Boolean(raw.glow),
    glowBlur: maskClamp(raw.glowBlur, 2, 40, d.glowBlur),
    glowColor: maskHex(raw.glowColor, d.glowColor),
    grad: Boolean(raw.grad),
    gradAngle: Math.round(maskClamp(raw.gradAngle, 0, 360, d.gradAngle)),
    grad1: maskHex(raw.grad1, d.grad1),
    grad2: maskHex(raw.grad2, d.grad2),
    group: typeof raw.group === 'string' && /^g_[a-z0-9]{3,12}$/.test(raw.group) ? raw.group : null
  };
}

/* Normalizza una lista di blocchi grezzi; i gruppi ricevono id nuovi per non scontrarsi con quelli esistenti */
function maskBlocksFrom(rawList) {
  const groups = new Map();
  return (Array.isArray(rawList) ? rawList : []).slice(0, MASK_MAX_BLOCKS).map(r => {
    const b = normalizeBlock(r);
    if (b.group) { if (!groups.has(b.group)) groups.set(b.group, maskNewGroup()); b.group = groups.get(b.group); }
    return b;
  });
}

/* ── Selezione ── */
function maskSetSelection(ids, primary) {
  const set = new Set(ids);
  // un blocco in un gruppo si muove (e si seleziona) con tutto il gruppo
  maskBlocks.forEach(b => { if (b.group && maskBlocks.some(o => set.has(o.id) && o.group === b.group)) set.add(b.id); });
  maskSel = set;
  maskPrimary = set.has(primary) ? primary : (maskBlocks.find(b => set.has(b.id))?.id ?? null);
}

function maskToggleInSelection(id) {
  const blk = maskById(id);
  const ids = new Set(maskSel);
  if (ids.has(id)) {
    if (ids.size === 1) return;     // almeno un blocco resta selezionato
    ids.delete(id);
    if (blk?.group) maskBlocks.forEach(b => { if (b.group === blk.group) ids.delete(b.id); });
    maskSetSelection([...ids], maskPrimary === id ? null : maskPrimary);
  } else {
    ids.add(id);
    maskSetSelection([...ids], id);
  }
}

function maskApplySelectionClasses() {
  maskEls.forEach((el, id) => {
    el.classList.toggle('selected', maskSel.has(id));
    el.classList.toggle('primary', id === maskPrimary);
  });
}

/* ── Annulla / Ripeti ──
   maskBeforeChange() va chiamata PRIMA di modificare. Con la stessa chiave entro 0,9 s
   (trascinare uno slider, scrivere) le modifiche confluiscono in un solo passo. */
const maskSnapshot = () => JSON.stringify({ blocks: maskBlocks, sel: [...maskSel], primary: maskPrimary });

function maskBeforeChange(key) {
  const now = Date.now();
  if (key && key === maskLastKey && now - maskLastT < 900) { maskLastT = now; return; }
  maskLastKey = key || null; maskLastT = now;
  maskUndo.push(maskSnapshot());
  if (maskUndo.length > 100) maskUndo.shift();
  maskRedo.length = 0;
  maskUpdateHistoryButtons();
}

function maskRestore(snap) {
  const o = JSON.parse(snap);
  maskBlocks = o.blocks; maskSel = new Set(o.sel); maskPrimary = o.primary;
  maskLastKey = null;
  maskRefreshAll();
}
function maskDoUndo() { if (!maskUndo.length) return; maskRedo.push(maskSnapshot()); maskRestore(maskUndo.pop()); }
function maskDoRedo() { if (!maskRedo.length) return; maskUndo.push(maskSnapshot()); maskRestore(maskRedo.pop()); }
function maskClearHistory() { maskUndo.length = 0; maskRedo.length = 0; maskLastKey = null; maskUpdateHistoryButtons(); }

function maskUpdateHistoryButtons() {
  $('#btnUndo').disabled = !maskUndo.length;
  $('#btnRedo').disabled = !maskRedo.length;
}

function maskRefreshAll() {
  maskRenderUI();
  renderOverlay();
  maskUpdateHistoryButtons();
}

/* ── Preset ── */
function maskUserPresets() {
  try {
    const a = JSON.parse(localStorage.getItem(MASK_PRESET_KEY) || '[]');
    return Array.isArray(a) ? a.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.blocks)).slice(0, 50) : [];
  } catch { return []; }
}
function maskSaveUserPresets(list) {
  try { localStorage.setItem(MASK_PRESET_KEY, JSON.stringify(list)); return true; } catch { return false; }
}

function maskFillPresetSelect(selected) {
  const sel = $('#maskPreset');
  sel.replaceChildren();
  for (const [id, p] of Object.entries(MASK_PRESETS)) sel.add(new Option(p.name, id));
  const mine = maskUserPresets();
  if (mine.length) {
    const g = document.createElement('optgroup'); g.label = 'I tuoi preset';
    mine.forEach(p => g.append(new Option(p.name, 'u:' + p.id)));
    sel.append(g);
  }
  if (selected) sel.value = selected;
  maskUpdatePresetButtons();
}
function maskUpdatePresetButtons() {
  $('#btnMaskDelPreset').classList.toggle('hidden', !$('#maskPreset').value.startsWith('u:'));
}

/* silent: stato iniziale (nessun passo di annullamento) */
function applyMaskPreset(id, { silent = false } = {}) {
  let raw = null;
  if (id.startsWith('u:')) raw = maskUserPresets().find(p => 'u:' + p.id === id)?.blocks;
  else raw = MASK_PRESETS[id]?.blocks;
  if (!raw) return;
  maskApplyBlocks(raw, silent);
}

function maskApplyBlocks(raw, silent = false) {
  const blocks = maskBlocksFrom(raw);
  if (!blocks.length) return;
  if (silent) maskClearHistory(); else maskBeforeChange();
  maskBlocks = blocks;
  maskSetSelection([blocks[0].id], blocks[0].id);
  maskEnabled = true;
  $('#maskToggle').checked = true;
  maskRefreshAll();
}

/* ── Lista blocchi + controlli ── */
function maskRenderUI() {
  const list = $('#maskBlocks');
  list.replaceChildren();
  if (!maskBlocks.length) {
    const e = document.createElement('div'); e.className = 'mask-empty';
    e.textContent = 'Nessun blocco testo. Applica un preset o aggiungine uno.';
    list.append(e);
  }
  maskBlocks.forEach((blk, i) => {
    const d = document.createElement('div');
    d.className = 'mask-blk' + (maskSel.has(blk.id) ? ' on' : '');
    d.setAttribute('role', 'button'); d.tabIndex = 0;
    d.setAttribute('aria-pressed', String(maskSel.has(blk.id)));
    const num = document.createElement('span'); num.className = 'mask-blk-num'; num.textContent = i + 1;
    const txt = document.createElement('span'); txt.className = 'mask-blk-text';
    txt.textContent = (blk.text || '').split('\n')[0] || '…';
    d.append(num, txt);
    if (blk.group) { const g = document.createElement('span'); g.textContent = '🔗'; g.title = 'Blocco in gruppo'; d.append(g); }
    const pick = (additive) => {
      if (additive) maskToggleInSelection(blk.id); else maskSetSelection([blk.id], blk.id);
      maskRenderUI(); maskApplySelectionClasses();
    };
    d.onclick = e => pick(e.shiftKey);
    d.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e.shiftKey); } };
    list.append(d);
  });
  maskSyncControls();
}

function maskSyncControls() {
  const blk = maskPrimaryBlock();
  $('#maskControls').classList.toggle('mc-hidden', !blk);
  if (blk) maskShowControls(blk);
  const n = maskSel.size, total = maskBlocks.length;
  $('#btnMaskAddBlk').disabled = total >= MASK_MAX_BLOCKS;
  $('#btnMaskDelBlk').disabled = !n || n >= total;
  $('#btnMaskDup').disabled = !n || total + n > MASK_MAX_BLOCKS;
  $('#btnMaskCopyStyle').disabled = !blk;
  $('#btnMaskPasteStyle').disabled = !maskStyleClip || !n;
  $('#btnMaskGroup').disabled = n < 2;
  $('#btnMaskUngroup').disabled = !maskSelectedBlocks().some(b => b.group);
  $('#btnMaskFwd').disabled = $('#btnMaskBack').disabled = !n;
}

function maskShowControls(b) {
  $('#mcText').value = b.text;
  $('#mcFont').value = b.font;
  $('#mcWeight').value = b.weight;
  $('#mcSize').value = b.size;
  $('#mcOpacity').value = Math.round(b.opacity * 100);
  $('#mcRot').value = b.rotation;
  $('#mcLH').value = Math.round(b.lineH * 100);
  $('#mcX').value = b.x;
  $('#mcY').value = b.y;
  $('#mcAlign').value = b.align;
  $('#mcColor').value = b.color;
  $('#mcBg').checked = b.bg;
  $('#mcShadow').checked = b.shadow;
  $('#mcStroke').checked = b.stroke;
  $('#mcStrokeW').value = b.strokeW;
  $('#mcStrokeColor').value = b.strokeColor;
  $('#mcGlow').checked = b.glow;
  $('#mcGlowBlur').value = b.glowBlur;
  $('#mcGlowColor').value = b.glowColor;
  $('#mcGrad').checked = b.grad;
  $('#mcGradAngle').value = b.gradAngle;
  $('#mcGrad1').value = b.grad1;
  $('#mcGrad2').value = b.grad2;
  maskUpdateLabels(b);
}

function maskUpdateLabels(b) {
  $('#mcSizeVal').textContent = maskFmt(b.size);
  $('#mcOpacityVal').textContent = Math.round(b.opacity * 100);
  $('#mcRotVal').textContent = b.rotation;
  $('#mcLHVal').textContent = b.lineH.toFixed(2);
  $('#mcXVal').textContent = maskFmt(b.x);
  $('#mcYVal').textContent = maskFmt(b.y);
  $('#mcStrokeWVal').textContent = b.strokeW;
  $('#mcGlowBlurVal').textContent = b.glowBlur;
  $('#mcGradAngleVal').textContent = b.gradAngle;
}

const MASK_CONTROL_IDS = ['mcText', 'mcFont', 'mcWeight', 'mcSize', 'mcOpacity', 'mcRot', 'mcLH', 'mcX', 'mcY', 'mcAlign',
  'mcColor', 'mcBg', 'mcShadow', 'mcStroke', 'mcStrokeW', 'mcStrokeColor', 'mcGlow', 'mcGlowBlur', 'mcGlowColor',
  'mcGrad', 'mcGradAngle', 'mcGrad1', 'mcGrad2'];

function maskReadControls(blk) {
  const num = id => Number($('#' + id).value);
  const nb = normalizeBlock({
    text: $('#mcText').value, font: $('#mcFont').value, weight: num('mcWeight'), size: num('mcSize'),
    opacity: num('mcOpacity') / 100, rotation: num('mcRot'), lineH: num('mcLH') / 100, x: num('mcX'), y: num('mcY'),
    align: $('#mcAlign').value, color: $('#mcColor').value, bg: $('#mcBg').checked, shadow: $('#mcShadow').checked,
    stroke: $('#mcStroke').checked, strokeW: num('mcStrokeW'), strokeColor: $('#mcStrokeColor').value,
    glow: $('#mcGlow').checked, glowBlur: num('mcGlowBlur'), glowColor: $('#mcGlowColor').value,
    grad: $('#mcGrad').checked, gradAngle: num('mcGradAngle'), grad1: $('#mcGrad1').value, grad2: $('#mcGrad2').value
  });
  // X/Y: tutta la selezione (gruppi inclusi) si sposta dello stesso scarto
  const dx = nb.x - blk.x, dy = nb.y - blk.y;
  if (dx || dy) {
    for (const o of maskSelectedBlocks()) {
      if (o === blk) continue;
      o.x = maskClamp(o.x + dx, 0, 100, o.x); o.y = maskClamp(o.y + dy, 0, 100, o.y);
    }
  }
  const { id, group, ...vals } = nb;
  Object.assign(blk, vals);
}

function maskOnControl(e) {
  const blk = maskPrimaryBlock();
  if (!blk) return;
  maskBeforeChange('c:' + e.target.id);
  maskReadControls(blk);
  maskUpdateLabels(blk);
  maskUpdateListLabel(blk);
  maskUpdateHistoryButtons();
  renderOverlay();
}

function maskUpdateListLabel(blk) {
  const i = maskBlocks.indexOf(blk);
  const t = $$('#maskBlocks .mask-blk .mask-blk-text')[i];
  if (t) t.textContent = (blk.text || '').split('\n')[0] || '…';
}

/* ── Overlay sull'immagine ── */
function renderOverlay() {
  const stage = $('#stage');
  const img = stage.querySelector('img');
  if (!img || !maskEnabled || !maskBlocks.length) {
    const ov = stage.querySelector('.mask-overlay');
    if (ov) ov.remove();
    maskEls.clear();
    return;
  }

  let ov = stage.querySelector('.mask-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = 'mask-overlay';
    stage.append(ov);
  }

  const focusId = ov.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  ov.replaceChildren(); maskEls.clear();
  maskBlocks.forEach((blk, i) => {
    const el = document.createElement('div');
    el.className = 'mask-blk-overlay' + (maskSel.has(blk.id) ? ' selected' : '') + (blk.id === maskPrimary ? ' primary' : '');
    el.dataset.id = blk.id;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Blocco ${i + 1}: ${(blk.text || '').split('\n')[0] || 'vuoto'}`);
    el.style.cssText = maskBlockCSS(blk);
    const t = document.createElement('div');
    t.className = 'mask-txt';
    t.textContent = blk.text ? (blk.text.endsWith('\n') ? blk.text + '​' : blk.text) : ' ';
    t.style.cssText = maskTextCSS(blk);
    el.append(t);
    el.onpointerdown = e => maskPointerDown(e, blk.id, el);
    ov.append(el); maskEls.set(blk.id, el);
  });
  if (focusId) maskEls.get(focusId)?.focus({ preventScroll: true });
  positionOverlay();
}

/* L'overlay copre esattamente l'immagine (non tutto lo stage) e porta la scala --k */
function positionOverlay() {
  const stage = $('#stage');
  const img = stage.querySelector('img');
  const ov = stage.querySelector('.mask-overlay');
  if (!img || !ov || !img.clientWidth) return;
  ov.style.left = img.offsetLeft + 'px';
  ov.style.top = img.offsetTop + 'px';
  ov.style.width = img.clientWidth + 'px';
  ov.style.height = img.clientHeight + 'px';
  ov.style.setProperty('--k', img.clientWidth / MASK_REF_W);
}

let stageObserver = null;
function watchStage(img) {
  if (stageObserver) stageObserver.disconnect();
  img.addEventListener('load', renderOverlay);
  stageObserver = new ResizeObserver(positionOverlay);   // ridimensionamento finestra/immagine
  stageObserver.observe(img);
  stageObserver.observe($('#stage'));
}

/* Effetti ombra/glow in una sola lista, usata da CSS, canvas e SVG. Unità: px alla scala k=1.
   L'ultimo elemento è quello disegnato sopra. */
function maskEffects(blk) {
  const fx = [];
  if (blk.glow) {
    const e = { rgb: blk.glowColor, alpha: 1, blur: blk.glowBlur, dy: 0 };
    fx.push(e, e);   // due passate: alone più denso
  }
  if (blk.shadow && !blk.bg) fx.push({ rgb: '#000000', alpha: 0.5, blur: 12, dy: 0 }, { rgb: '#000000', alpha: 0.7, blur: 3, dy: 1 });
  return fx;
}

/* Gradiente come CSS linear-gradient(angolo): 0° verso l'alto, 90° verso destra.
   Coordinate relative al centro di un riquadro w × h. */
function maskGradPoints(angleDeg, w, h) {
  const a = angleDeg * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
  const half = (Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a))) / 2;
  return { x1: -dx * half, y1: -dy * half, x2: dx * half, y2: dy * half };
}

/* Blocco esterno: posizione, rotazione, font, riquadro di sfondo */
function maskBlockCSS(blk) {
  const K = 'var(--k, 1)';
  const shiftX = blk.align === 'right' ? '-100%' : blk.align === 'center' ? '-50%' : '0';
  let css = `left:${blk.x}%; top:${blk.y}%;`
    + ` transform:translate(${shiftX}, -50%)${blk.rotation ? ` rotate(${blk.rotation}deg)` : ''};`
    + ` font:${blk.weight} calc(${K} * ${blk.size}px)/${blk.lineH} ${maskFamily(blk)};`
    + ` text-align:${blk.align}; opacity:${blk.opacity}; white-space:pre;`;
  if (blk.bg) {
    css += ` background:rgba(0,0,0,0.5); padding:calc(${K} * ${MASK_PAD_Y}px) calc(${K} * ${MASK_PAD_X}px);`
      + ` border-radius:calc(${K} * ${MASK_RADIUS}px);`;
  }
  return css;
}

/* Blocco interno: colore/gradiente, contorno, ombra e glow */
function maskTextCSS(blk) {
  const K = 'var(--k, 1)';
  const fx = maskEffects(blk);
  let css = 'display:block;';
  if (blk.grad) {
    css += ` background:linear-gradient(${blk.gradAngle}deg, ${blk.grad1}, ${blk.grad2});`
      + ' -webkit-background-clip:text; background-clip:text; color:transparent;';
  } else {
    css += ` color:${blk.color};`;
  }
  if (blk.stroke) {
    css += ` -webkit-text-stroke:calc(${K} * ${blk.strokeW}px) ${blk.strokeColor};` + (blk.grad ? '' : ' paint-order:stroke fill;');
  } else if (blk.bg) {
    css += ` -webkit-text-stroke:calc(${K} * 1px) rgba(0,0,0,0.6);`;
  }
  if (fx.length) {
    const layer = e => `calc(${K} * ${e.dy}px) calc(${K} * ${e.blur}px) ${hexRgba(e.rgb, e.alpha)}`;
    // con il gradiente text-shadow coprirebbe il riempimento: si usa drop-shadow
    if (blk.grad) css += ` filter:${fx.map(e => `drop-shadow(0 ${layer(e)})`).join(' ')};`;
    else css += ` text-shadow:${fx.slice().reverse().map(e => `0 ${layer(e)}`).join(', ')};`;
  }
  return css;
}

/* ── Trascinamento, tastiera ── */
function maskPointerDown(e, id, el) {
  if (e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  el.focus({ preventScroll: true });
  const wasSelected = maskSel.has(id);
  if (e.shiftKey) {
    maskToggleInSelection(id);
    maskRenderUI(); maskApplySelectionClasses();
    return;                                   // Shift+click: solo selezione, niente trascinamento
  }
  if (!wasSelected) maskSetSelection([id], id); else maskPrimary = id;
  maskRenderUI(); maskApplySelectionClasses();

  const ov = $('#stage .mask-overlay');
  const r = ov.getBoundingClientRect();
  maskDrag = {
    id, startX: e.clientX, startY: e.clientY, w: r.width || 1, h: r.height || 1, moved: false,
    collapse: wasSelected && maskSel.size > 1,   // click senza movimento su una selezione multipla → solo quel blocco
    origin: new Map(maskSelectedBlocks().map(b => [b.id, { x: b.x, y: b.y }]))
  };
  el.setPointerCapture(e.pointerId);
  el.onpointermove = maskPointerMove;
  el.onpointerup = el.onpointercancel = maskPointerUp;
}

function maskPlace(blk) {
  const el = maskEls.get(blk.id);
  if (el) { el.style.left = blk.x + '%'; el.style.top = blk.y + '%'; }
}

function maskPointerMove(e) {
  const d = maskDrag;
  if (!d) return;
  const dxPx = e.clientX - d.startX, dyPx = e.clientY - d.startY;
  if (!d.moved) {
    if (Math.hypot(dxPx, dyPx) < 3) return;
    d.moved = true;
    maskBeforeChange('drag'); maskLastKey = null;   // ogni trascinamento è un passo a sé
  }
  const dx = dxPx / d.w * 100, dy = dyPx / d.h * 100;
  for (const [bid, o] of d.origin) {
    const b = maskById(bid);
    if (!b) continue;
    b.x = Math.round(maskClamp(o.x + dx, 0, 100, o.x) * 10) / 10;
    b.y = Math.round(maskClamp(o.y + dy, 0, 100, o.y) * 10) / 10;
    maskPlace(b);
  }
  const p = maskPrimaryBlock();
  if (p) { $('#mcX').value = p.x; $('#mcY').value = p.y; maskUpdateLabels(p); }
  maskUpdateHistoryButtons();
}

function maskPointerUp(e) {
  const d = maskDrag; maskDrag = null;
  const el = e.currentTarget;
  el.onpointermove = el.onpointerup = el.onpointercancel = null;
  if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
  if (d && !d.moved && d.collapse) {
    maskSetSelection([d.id], d.id);
    maskRenderUI(); maskApplySelectionClasses();
  }
}

function maskNudge(dx, dy) {
  const sel = maskSelectedBlocks();
  if (!sel.length) return;
  maskBeforeChange('arrow');
  sel.forEach(b => {
    b.x = Math.round(maskClamp(b.x + dx, 0, 100, b.x) * 10) / 10;
    b.y = Math.round(maskClamp(b.y + dy, 0, 100, b.y) * 10) / 10;
    maskPlace(b);
  });
  const p = maskPrimaryBlock();
  if (p) { $('#mcX').value = p.x; $('#mcY').value = p.y; maskUpdateLabels(p); }
  maskUpdateHistoryButtons();
}

/* Le scorciatoie valgono solo con il focus dentro la mascherina o sullo stage:
   altrimenti le frecce non scorrerebbero più la pagina */
function maskOnKeydown(e) {
  if (!maskBlocks.length || $('#maskPanel').classList.contains('hidden')) return;
  const t = e.target;
  if (!t.closest || !t.closest('#maskPanel, #stage')) return;
  if (t.matches('input, textarea, select') || t.isContentEditable) return;
  const ctrl = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
  if (ctrl && key === 'z' && !e.shiftKey) { e.preventDefault(); maskDoUndo(); }
  else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); maskDoRedo(); }
  else if (ctrl && e.key === ']') { e.preventDefault(); maskReorder(1); }
  else if (ctrl && e.key === '[') { e.preventDefault(); maskReorder(-1); }
  else if (!ctrl && !e.altKey && e.key.startsWith('Arrow') && maskSel.size) {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    maskNudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
              e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
  }
}

/* ── Operazioni sui blocchi ── */
function maskReorder(dir) {
  if (!maskSel.size) return;
  maskBeforeChange();
  const a = maskBlocks, s = id => maskSel.has(id);
  if (dir > 0) { for (let i = a.length - 2; i >= 0; i--) if (s(a[i].id) && !s(a[i + 1].id)) [a[i], a[i + 1]] = [a[i + 1], a[i]]; }
  else { for (let i = 1; i < a.length; i++) if (s(a[i].id) && !s(a[i - 1].id)) [a[i], a[i - 1]] = [a[i - 1], a[i]]; }
  maskRefreshAll();
}

function maskAddBlock() {
  if (maskBlocks.length >= MASK_MAX_BLOCKS) return log(`Massimo ${MASK_MAX_BLOCKS} blocchi.`);
  maskBeforeChange();
  const last = maskBlocks[maskBlocks.length - 1];
  const blk = normalizeBlock({ ...(last ? Object.fromEntries(MASK_STYLE_KEYS.map(k => [k, last[k]])) : {}),
    text: 'Nuovo testo', x: last ? last.x : 50, y: last ? Math.min(last.y + 8, 90) : 50, size: 22, weight: 500 });
  maskBlocks.push(blk);
  maskSetSelection([blk.id], blk.id);
  maskEnabled = true; $('#maskToggle').checked = true;
  maskRefreshAll();
}

function maskDuplicate() {
  const src = maskSelectedBlocks();
  if (!src.length || maskBlocks.length + src.length > MASK_MAX_BLOCKS) return;
  maskBeforeChange();
  const groups = new Map();
  const clones = src.map(b => {
    const c = { ...b, id: maskNewId(), x: maskClamp(b.x + 2, 0, 100, b.x), y: maskClamp(b.y + 2, 0, 100, b.y) };
    if (b.group) { if (!groups.has(b.group)) groups.set(b.group, maskNewGroup()); c.group = groups.get(b.group); }
    return c;
  });
  maskBlocks.push(...clones);
  const prim = clones[src.findIndex(b => b.id === maskPrimary)] || clones[0];
  maskSetSelection(clones.map(c => c.id), prim.id);
  maskRefreshAll();
}

function maskDeleteSelected() {
  if (!maskSel.size || maskSel.size >= maskBlocks.length) return;
  maskBeforeChange();
  const first = maskBlocks.findIndex(b => maskSel.has(b.id));
  maskBlocks = maskBlocks.filter(b => !maskSel.has(b.id));
  const next = maskBlocks[Math.min(first, maskBlocks.length - 1)];
  maskSetSelection([next.id], next.id);
  maskRefreshAll();
}

function maskGroupSelected() {
  if (maskSel.size < 2) return;
  maskBeforeChange();
  const g = maskNewGroup();
  maskSelectedBlocks().forEach(b => { b.group = g; });
  maskRefreshAll();
}

function maskUngroupSelected() {
  const sel = maskSelectedBlocks().filter(b => b.group);
  if (!sel.length) return;
  maskBeforeChange();
  sel.forEach(b => { b.group = null; });
  maskRefreshAll();
}

function maskCopyStyle() {
  const b = maskPrimaryBlock();
  if (!b) return;
  maskStyleClip = Object.fromEntries(MASK_STYLE_KEYS.map(k => [k, b[k]]));
  maskSyncControls();
  log('Stile copiato.');
}

function maskPasteStyle() {
  if (!maskStyleClip || !maskSel.size) return;
  maskBeforeChange();
  maskSelectedBlocks().forEach(b => Object.assign(b, maskStyleClip));
  maskRefreshAll();
}

/* ── Geometria del blocco sul canvas (e per l'SVG) ── */
function maskGeometry(ctx, blk, W, H, k) {
  const size = blk.size * k, lh = size * blk.lineH;
  const lines = String(blk.text || '').split('\n');
  const padX = blk.bg ? MASK_PAD_X * k : 0, padY = blk.bg ? MASK_PAD_Y * k : 0;
  ctx.font = `${blk.weight} ${size}px ${maskFamily(blk)}`;
  const textW = Math.max(0, ...lines.map(l => ctx.measureText(l).width));
  const textH = lines.length * lh;
  const bw = textW + padX * 2, bh = textH + padY * 2;
  const ax = blk.x / 100 * W, ay = blk.y / 100 * H;
  const cx = blk.align === 'left' ? ax + bw / 2 : blk.align === 'right' ? ax - bw / 2 : ax;
  // x del testo rispetto al centro del blocco, secondo l'allineamento
  const tx = blk.align === 'left' ? -bw / 2 + padX : blk.align === 'right' ? bw / 2 - padX : 0;
  return { size, lh, lines, padX, padY, textW, textH, bw, bh, cx, cy: ay, tx };
}

/* Disegna un blocco sul canvas con la stessa geometria dell'anteprima */
function drawMaskBlock(ctx, blk, W, H, k) {
  ctx.save();
  const g = maskGeometry(ctx, blk, W, H, k);
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = blk.opacity;
  ctx.translate(g.cx, g.cy);
  if (blk.rotation) ctx.rotate(blk.rotation * Math.PI / 180);

  if (blk.bg) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-g.bw / 2, -g.bh / 2, g.bw, g.bh, MASK_RADIUS * k); else ctx.rect(-g.bw / 2, -g.bh / 2, g.bw, g.bh);
    ctx.fill();
  }

  ctx.textAlign = blk.align;
  ctx.lineJoin = 'round';
  let fill = blk.color;
  if (blk.grad) {
    const p = maskGradPoints(blk.gradAngle, g.textW, g.textH);
    fill = ctx.createLinearGradient(p.x1, p.y1, p.x2, p.y2);
    fill.addColorStop(0, blk.grad1); fill.addColorStop(1, blk.grad2);
  }
  const fx = maskEffects(blk);
  g.lines.forEach((line, i) => {
    const ty = -g.textH / 2 + (i + 0.5) * g.lh;
    ctx.fillStyle = fill;
    for (const e of fx) {   // ogni effetto è una passata con ombra
      ctx.shadowColor = hexRgba(e.rgb, e.alpha); ctx.shadowBlur = e.blur * k; ctx.shadowOffsetY = e.dy * k;
      ctx.fillText(line, g.tx, ty);
    }
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    if (blk.stroke) {
      ctx.lineWidth = blk.strokeW * k; ctx.strokeStyle = blk.strokeColor;
      if (blk.grad) { ctx.fillText(line, g.tx, ty); ctx.strokeText(line, g.tx, ty); }   // come CSS: con gradiente il contorno sta sopra
      else { ctx.strokeText(line, g.tx, ty); ctx.fillText(line, g.tx, ty); }              // paint-order: stroke fill
    } else {
      ctx.fillText(line, g.tx, ty);
      if (blk.bg) { ctx.lineWidth = k; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(line, g.tx, ty); }
    }
  });
  ctx.restore();
}

function maskLoadFonts(blocks, k) {
  return Promise.all(blocks.map(b => document.fonts.load(`${b.weight} ${b.size * k}px "${b.font}"`).catch(() => {})));
}

function maskLoadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => res(img); img.onerror = rej; img.src = url;
  });
}

/* ── Esportazione ── */

async function compositeMask(imgUrl, format) {
  const img = await maskLoadImage(imgUrl);
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);

  if (maskEnabled && maskBlocks.length) {
    const k = W / MASK_REF_W;
    await maskLoadFonts(maskBlocks, k);   // senza font caricati si disegnerebbe col carattere di ripiego
    maskBlocks.forEach(blk => drawMaskBlock(ctx, blk, W, H, k));
  }

  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const quality = format === 'png' ? undefined : 0.9;
  return await new Promise(r => c.toBlob(r, mime, quality));
}

/* PNG trasparente con solo il testo, alla risoluzione dell'immagine corrente */
async function maskTextPng(imgUrl) {
  const img = await maskLoadImage(imgUrl);
  const W = img.naturalWidth, H = img.naturalHeight, k = W / MASK_REF_W;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  await maskLoadFonts(maskBlocks, k);
  maskBlocks.forEach(blk => drawMaskBlock(ctx, blk, W, H, k));
  return await new Promise(r => c.toBlob(r, 'image/png'));
}

/* SVG con solo il testo (testi modificabili). I font vanno installati nel programma che lo apre. */
async function maskTextSvg(imgUrl) {
  const img = await maskLoadImage(imgUrl);
  const W = img.naturalWidth, H = img.naturalHeight, k = W / MASK_REF_W;
  await maskLoadFonts(maskBlocks, k);
  const m = document.createElement('canvas').getContext('2d');
  const n = v => Math.round(v * 100) / 100;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const defs = [], body = [];

  maskBlocks.forEach((blk, i) => {
    const g = maskGeometry(m, blk, W, H, k);
    const fx = maskEffects(blk);
    let filterAttr = '';
    if (fx.length) {
      let parts = '', merge = '';
      fx.forEach((e, j) => {
        parts += `<feGaussianBlur in="SourceAlpha" stdDeviation="${n(e.blur * k / 2)}" result="b${j}"/>`
          + `<feOffset in="b${j}" dx="0" dy="${n(e.dy * k)}" result="o${j}"/>`
          + `<feFlood flood-color="${e.rgb}" flood-opacity="${e.alpha}" result="c${j}"/>`
          + `<feComposite in="c${j}" in2="o${j}" operator="in" result="s${j}"/>`;
        merge += `<feMergeNode in="s${j}"/>`;
      });
      defs.push(`<filter id="fx${i}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${parts}<feMerge>${merge}<feMergeNode in="SourceGraphic"/></feMerge></filter>`);
      filterAttr = ` filter="url(#fx${i})"`;
    }
    let fill = blk.color;
    if (blk.grad) {
      const p = maskGradPoints(blk.gradAngle, g.textW, g.textH);
      defs.push(`<linearGradient id="gr${i}" gradientUnits="userSpaceOnUse" x1="${n(p.x1)}" y1="${n(p.y1)}" x2="${n(p.x2)}" y2="${n(p.y2)}">`
        + `<stop offset="0" stop-color="${blk.grad1}"/><stop offset="1" stop-color="${blk.grad2}"/></linearGradient>`);
      fill = `url(#gr${i})`;
    }
    let strokeAttr = '';
    if (blk.stroke) strokeAttr = ` stroke="${blk.strokeColor}" stroke-width="${n(blk.strokeW * k)}" stroke-linejoin="round"` + (blk.grad ? '' : ' paint-order="stroke"');
    else if (blk.bg) strokeAttr = ` stroke="#000000" stroke-opacity="0.6" stroke-width="${n(k)}" stroke-linejoin="round"`;

    const anchor = blk.align === 'left' ? 'start' : blk.align === 'right' ? 'end' : 'middle';
    const tspans = g.lines.map((line, j) => {
      // baseline alfabetica (compatibile con gli editor): il centro della riga cade ~0,35 em sopra
      const y = -g.textH / 2 + (j + 0.5) * g.lh + g.size * 0.35;
      return `<tspan x="${n(g.tx)}" y="${n(y)}">${esc(line) || ' '}</tspan>`;
    }).join('');
    const rect = blk.bg
      ? `<rect x="${n(-g.bw / 2)}" y="${n(-g.bh / 2)}" width="${n(g.bw)}" height="${n(g.bh)}" rx="${n(MASK_RADIUS * k)}" fill="#000000" fill-opacity="0.5"/>` : '';
    body.push(`<g transform="translate(${n(g.cx)} ${n(g.cy)})${blk.rotation ? ` rotate(${blk.rotation})` : ''}" opacity="${blk.opacity}">${rect}`
      + `<text xml:space="preserve" font-family="${esc(maskFamily(blk))}" font-size="${n(g.size)}" font-weight="${blk.weight}"`
      + ` text-anchor="${anchor}" fill="${fill}"${strokeAttr}${filterAttr}>${tspans}</text></g>`);
  });

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + (defs.length ? `<defs>${defs.join('')}</defs>` : '') + body.join('') + `</svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

function maskEnableDownloads() {
  $('#btnDlMask').disabled = $('#btnDlMaskPng').disabled = $('#btnDlMaskSvg').disabled = false;
}

/* ── Preset personali, JSON, immagine di base ── */
function maskSavePreset() {
  const name = $('#maskPresetName').value.trim().slice(0, 40);
  if (!name) { $('#maskPresetName').focus(); return log('Scrivi un nome per il preset.'); }
  if (!maskBlocks.length) return log('Nessun blocco da salvare.');
  const list = maskUserPresets();
  const blocks = maskBlocks.map(({ id, ...b }) => b);
  const existing = list.find(p => p.name === name);
  const preset = existing || { id: maskRand(), name, blocks };
  preset.blocks = blocks;
  if (!existing) list.push(preset);
  if (!maskSaveUserPresets(list)) return log('Impossibile salvare il preset (archivio del browser non disponibile).');
  $('#maskPresetName').value = '';
  maskFillPresetSelect('u:' + preset.id);
  log(`Preset "${name}" salvato.`);
}

function maskDeletePreset() {
  const v = $('#maskPreset').value;
  if (!v.startsWith('u:')) return;
  const p = maskUserPresets().find(x => 'u:' + x.id === v);
  if (!p || !confirm(`Eliminare il preset "${p.name}"?`)) return;
  maskSaveUserPresets(maskUserPresets().filter(x => 'u:' + x.id !== v));
  maskFillPresetSelect('custom');
  log(`Preset "${p.name}" eliminato.`);
}

function maskExportJson() {
  if (!maskBlocks.length) return log('Nessun blocco da esportare.');
  const data = { app: 'coverforge-studio', kind: 'mask', version: 1, blocks: maskBlocks.map(({ id, ...b }) => b) };
  saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `coverforge-mascherina-${Date.now()}.json`);
}

async function maskImportJson(file) {
  try {
    if (file.size > 1024 * 1024) throw new Error('file troppo grande');
    const data = JSON.parse(await file.text());
    const blocks = Array.isArray(data) ? data : data?.blocks;
    if (!Array.isArray(blocks) || !blocks.length) throw new Error('nessun blocco trovato');
    maskApplyBlocks(blocks);
    log(`Mascherina importata: ${Math.min(blocks.length, MASK_MAX_BLOCKS)} blocchi.`);
  } catch (e) { log('Importazione fallita: ' + e.message); }
}

function maskUseOwnImage(file) {
  if (!MASK_IMAGE_TYPES.includes(file.type)) return log('Formato non supportato (PNG, JPEG, WebP, GIF, BMP).');
  if (file.size > 25 * 1024 * 1024) return log('Immagine troppo grande (max 25 MB).');
  const fr = new FileReader();
  fr.onload = () => { renderImage(fr.result, { prompt: '' }); addToGallery(fr.result, { prompt: '' }); log(`Base: ${file.name}`); };
  fr.onerror = () => log('Impossibile leggere il file.');
  fr.readAsDataURL(file);
}

/* ── Avvio (chiamata da app.js) ── */
function initMask() {
  $('#mcFont').replaceChildren(...MASK_FONTS.map(f => { const o = new Option(f, f); o.style.fontFamily = `'${f}'`; return o; }));
  maskFillPresetSelect('custom');
  MASK_CONTROL_IDS.forEach(id => $('#' + id).addEventListener('input', maskOnControl));

  $('#maskToggle').onchange = () => {
    maskEnabled = $('#maskToggle').checked;
    if (maskEnabled && !maskBlocks.length) applyMaskPreset('custom');
    renderOverlay();
  };
  $('#maskPreset').onchange = () => { maskUpdatePresetButtons(); applyMaskPreset($('#maskPreset').value); };
  $('#btnMaskApply').onclick = () => applyMaskPreset($('#maskPreset').value);
  $('#btnMaskSave').onclick = maskSavePreset;
  $('#maskPresetName').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); maskSavePreset(); } };
  $('#btnMaskDelPreset').onclick = maskDeletePreset;

  $('#btnMaskExport').onclick = maskExportJson;
  $('#btnMaskImport').onclick = () => $('#maskJsonInput').click();
  $('#maskJsonInput').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) maskImportJson(f); };
  $('#btnMaskUploadImg').onclick = () => $('#maskImgInput').click();
  $('#maskImgInput').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) maskUseOwnImage(f); };

  $('#btnMaskAddBlk').onclick = maskAddBlock;
  $('#btnMaskDup').onclick = maskDuplicate;
  $('#btnMaskDelBlk').onclick = maskDeleteSelected;
  $('#btnMaskCopyStyle').onclick = maskCopyStyle;
  $('#btnMaskPasteStyle').onclick = maskPasteStyle;
  $('#btnMaskGroup').onclick = maskGroupSelected;
  $('#btnMaskUngroup').onclick = maskUngroupSelected;
  $('#btnMaskFwd').onclick = () => maskReorder(1);
  $('#btnMaskBack').onclick = () => maskReorder(-1);
  $('#btnUndo').onclick = maskDoUndo;
  $('#btnRedo').onclick = maskDoRedo;
  document.addEventListener('keydown', maskOnKeydown);

  const save = async (build, ext, prefix) => {
    if (!lastImage) return;
    try { saveBlob(await build(), `coverforge-${prefix}-${cat}-${Date.now()}.${ext}`); }
    catch (e) { log('Esportazione fallita: ' + e.message); }
  };
  $('#btnDlMask').onclick = () => {
    const fmt = $('#dlFormat').value;
    save(() => compositeMask(lastImage, fmt), fmt === 'jpeg' ? 'jpg' : fmt, 'mask');
  };
  $('#btnDlMaskPng').onclick = () => { if (maskBlocks.length) save(() => maskTextPng(lastImage), 'png', 'testo'); };
  $('#btnDlMaskSvg').onclick = () => { if (maskBlocks.length) save(() => maskTextSvg(lastImage), 'svg', 'testo'); };

  maskRenderUI();
  maskUpdateHistoryButtons();
}
