/* ═══════════════════════════════════════════════════
   V E T T O R I Z Z A Z I O N E   L O C A L E
   Immagine → SVG a colori piatti, tutto nel browser (nessun servizio esterno).
   Pensata per loghi e icone. Passi:
     1. riduzione dei colori (k-means su un istogramma 16×16×16)
     2. ritocco dei bordi (filtro a maggioranza 3×3)
     3. per ogni colore, dal più esteso: maschera → contorni sui lati dei pixel → semplificazione (Ramer-Douglas-Peucker)
   Ogni livello comprende anche i colori che stanno sopra di lui: tra un colore e l'altro non restano fessure.
   Usa maskLoadImage() di mask.js.
   ═══════════════════════════════════════════════════ */

const TRACE_TRANSPARENT = 255;

function traceQuantize(px, w, h, n) {
  const key = (r, g, b) => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
  const hist = new Float64Array(4096 * 4);   // per bin: conteggio, somma R, G, B
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    if (px[o + 3] < 128) continue;
    const k = key(px[o], px[o + 1], px[o + 2]) * 4;
    hist[k]++; hist[k + 1] += px[o]; hist[k + 2] += px[o + 1]; hist[k + 3] += px[o + 2];
  }
  const pts = [];
  for (let k = 0; k < 4096; k++) {
    const c = hist[k * 4];
    if (c > 0) pts.push({ k, w: c, r: hist[k * 4 + 1] / c, g: hist[k * 4 + 2] / c, b: hist[k * 4 + 3] / c });
  }
  const labels = new Uint8Array(w * h).fill(TRACE_TRANSPARENT);
  if (!pts.length) return { palette: [], labels };

  const dist2 = (p, c) => (p.r - c.r) ** 2 + (p.g - c.g) ** 2 + (p.b - c.b) ** 2;
  const m = Math.min(n, pts.length);

  // centri iniziali: il colore più frequente, poi sempre il più lontano dai centri già scelti (pesato)
  const heaviest = pts.reduce((a, p) => (p.w > a.w ? p : a));
  const centers = [{ r: heaviest.r, g: heaviest.g, b: heaviest.b }];
  const near = pts.map(p => dist2(p, centers[0]));
  while (centers.length < m) {
    let best = -1, score = 0;
    pts.forEach((p, i) => { const s = p.w * near[i]; if (s > score) { score = s; best = i; } });
    if (best < 0) break;
    const c = { r: pts[best].r, g: pts[best].g, b: pts[best].b };
    centers.push(c);
    pts.forEach((p, i) => { near[i] = Math.min(near[i], dist2(p, c)); });
  }

  const nearest = (p) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < centers.length; i++) { const d = dist2(p, centers[i]); if (d < bd) { bd = d; bi = i; } }
    return bi;
  };
  for (let it = 0; it < 10; it++) {
    const sum = centers.map(() => ({ w: 0, r: 0, g: 0, b: 0 }));
    for (const p of pts) { const s = sum[nearest(p)]; s.w += p.w; s.r += p.r * p.w; s.g += p.g * p.w; s.b += p.b * p.w; }
    let moved = 0;
    sum.forEach((s, i) => {
      if (!s.w) return;   // cluster vuoto: il centro resta dov'è
      const c = { r: s.r / s.w, g: s.g / s.w, b: s.b / s.w };
      moved += Math.abs(c.r - centers[i].r) + Math.abs(c.g - centers[i].g) + Math.abs(c.b - centers[i].b);
      centers[i] = c;
    });
    if (moved < 0.5) break;
  }

  const lut = new Uint8Array(4096).fill(TRACE_TRANSPARENT);
  for (const p of pts) lut[p.k] = nearest(p);
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    if (px[o + 3] >= 128) labels[i] = lut[key(px[o], px[o + 1], px[o + 2])];
  }
  return { palette: centers.map(c => ({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) })), labels };
}

/* Colori "di bordo": piccoli (< 1,5% dell'immagine) e allineati fra due colori grandi, cioè le sfumature
   dell'antialiasing tra una tinta e l'altra. Sparirebbero in tante microforme: i loro pixel passano al colore
   più vicino fra quelli che restano. Un vero accento di colore, che non sta fra due altri, si conserva. */
function traceDropBlends(palette, labels) {
  const area = new Array(palette.length).fill(0);
  let opaque = 0;
  for (const l of labels) if (l !== TRACE_TRANSPARENT) { area[l]++; opaque++; }
  const big = palette.map((_, i) => i).filter(i => area[i] >= opaque * 0.01);
  const dist = (p, q) => Math.hypot(p.r - q.r, p.g - q.g, p.b - q.b);

  const drop = new Set();
  palette.forEach((c, i) => {
    if (!area[i] || area[i] >= opaque * 0.015) return;
    for (let x = 0; x < big.length && !drop.has(i); x++) {
      for (let y = x + 1; y < big.length; y++) {
        const a = palette[big[x]], b = palette[big[y]];
        const vr = b.r - a.r, vg = b.g - a.g, vb = b.b - a.b, len2 = vr * vr + vg * vg + vb * vb;
        if (!len2) continue;
        const t = ((c.r - a.r) * vr + (c.g - a.g) * vg + (c.b - a.b) * vb) / len2;
        if (t < 0.03 || t > 0.97) continue;
        if (dist(c, { r: a.r + t * vr, g: a.g + t * vg, b: a.b + t * vb }) < 28) { drop.add(i); break; }
      }
    }
  });
  if (!drop.size) return labels;

  // ogni colore scartato passa al più vicino fra quelli che restano
  const kept = palette.map((_, i) => i).filter(i => area[i] && !drop.has(i));
  const map = new Uint8Array(256);
  for (let i = 0; i < 256; i++) map[i] = i;
  drop.forEach(i => { map[i] = kept.reduce((best, k) => (dist(palette[i], palette[k]) < dist(palette[i], palette[best]) ? k : best), kept[0]); });
  return labels.map(l => map[l]);
}

/* Un pixel diventa il colore prevalente del suo intorno 3×3 se questo copre almeno 5 pixel su 9 */
function traceSmoothLabels(src, w, h) {
  const out = Uint8Array.from(src);
  const cnt = new Uint8Array(256);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const ids = [src[i - w - 1], src[i - w], src[i - w + 1], src[i - 1], src[i], src[i + 1], src[i + w - 1], src[i + w], src[i + w + 1]];
      let best = src[i], bestN = 0;
      for (const l of ids) cnt[l]++;
      for (const l of ids) if (cnt[l] > bestN) { bestN = cnt[l]; best = l; }
      for (const l of ids) cnt[l] = 0;
      if (bestN >= 5) out[i] = best;
    }
  }
  return out;
}

/* Semplifica un poligono chiuso (Ramer-Douglas-Peucker, iterativo) */
function traceSimplify(pts, eps) {
  const n = pts.length;
  if (n < 4) return pts;
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const P = (i) => pts[i % n];
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [i, j] = stack.pop();
    if (j - i < 2) continue;
    const [x1, y1] = P(i), [x2, y2] = P(j);
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    let maxD = -1, maxK = -1;
    for (let k = i + 1; k < j; k++) {
      const [x, y] = P(k);
      const d = len ? Math.abs((x - x1) * dy - (y - y1) * dx) / len : Math.hypot(x - x1, y - y1);
      if (d > maxD) { maxD = d; maxK = k; }
    }
    if (maxD > eps) { keep[maxK % n] = 1; stack.push([i, maxK], [maxK, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const traceArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
};

/* Contorni di una maschera binaria (con bordo vuoto di 1 pixel) → attributo "d" di un path.
   Si seguono i lati dei pixel: i contorni esterni e i buchi risultano tutti poligoni chiusi (si riempiono con evenodd). */
function traceMask(mask, W2, H2, eps, minArea) {
  const VW = W2 + 1, V = VW * (H2 + 1);
  const e0 = new Int32Array(V).fill(-1), e1 = new Int32Array(V).fill(-1);
  const add = (a, b) => { if (e0[a] < 0) e0[a] = b; else e1[a] = b; };
  for (let y = 1; y < H2 - 1; y++) {
    for (let x = 1; x < W2 - 1; x++) {
      const i = y * W2 + x;
      if (!mask[i]) continue;
      const a = y * VW + x;                              // vertice in alto a sinistra del pixel
      if (!mask[i - W2]) add(a, a + 1);                  // lato alto  →
      if (!mask[i + 1]) add(a + 1, a + 1 + VW);          // lato destro ↓
      if (!mask[i + W2]) add(a + 1 + VW, a + VW);        // lato basso ←
      if (!mask[i - 1]) add(a + VW, a);                  // lato sinistro ↑
    }
  }
  const dirOf = (a, b) => { const d = b - a; return d === 1 ? 0 : d === VW ? 1 : d === -1 ? 2 : 3; };   // 0→ 1↓ 2← 3↑

  const parts = [];
  for (let s = 0; s < V; s++) {
    while (e0[s] >= 0) {
      const pts = [];
      let cur = s, prev = -1, last = -1;
      for (;;) {
        let next;
        if (e1[cur] >= 0) {
          // due archi in uscita (pixel in diagonale): si gira sempre a destra, così i contorni restano coerenti
          const right0 = prev >= 0 && ((dirOf(cur, e0[cur]) - prev + 4) % 4) === 1;
          if (right0 || prev < 0) { next = e0[cur]; e0[cur] = e1[cur]; e1[cur] = -1; }
          else { next = e1[cur]; e1[cur] = -1; }
        } else {
          next = e0[cur]; e0[cur] = -1;
        }
        const d = dirOf(cur, next);
        if (d !== last) { pts.push([(cur % VW) - 1, Math.floor(cur / VW) - 1]); last = d; }   // solo agli spigoli
        prev = d; cur = next;
        if (cur === s) break;
      }
      const simple = traceSimplify(pts, eps);
      if (simple.length >= 3 && traceArea(simple) >= minArea) {
        parts.push('M' + simple.map(p => p[0] + ' ' + p[1]).join('L') + 'Z');
      }
    }
  }
  return parts.join('');
}

const traceHex = (c) => '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
const traceTick = () => new Promise(r => setTimeout(r));   // lascia respirare l'interfaccia fra un colore e l'altro

/* Ritorna il testo dell'SVG. colors: 2-16. onProgress(fatti, totali). */
async function traceToSvg(imgUrl, { colors = 8, maxSide = 640, onProgress } = {}) {
  colors = Math.max(2, Math.min(16, Math.round(colors) || 8));
  const img = await maskLoadImage(imgUrl);
  const W = img.naturalWidth, H = img.naturalHeight;
  const sc = Math.min(1, maxSide / Math.max(W, H));
  const w = Math.max(1, Math.round(W * sc)), h = Math.max(1, Math.round(H * sc));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, w, h);
  const px = cx.getImageData(0, 0, w, h).data;

  const q = traceQuantize(px, w, h, colors);
  const labels = traceSmoothLabels(traceDropBlends(q.palette, q.labels), w, h);
  const area = new Array(q.palette.length).fill(0);
  for (const l of labels) if (l !== TRACE_TRANSPARENT) area[l]++;
  const order = q.palette.map((_, i) => i).filter(i => area[i] > 0).sort((a, b) => area[b] - area[a]);
  const rank = new Uint8Array(256).fill(255);
  order.forEach((l, r) => { rank[l] = r; });

  const W2 = w + 2, H2 = h + 2;
  const eps = 0.8, minArea = 3;
  const paths = [];
  for (let r = 0; r < order.length; r++) {
    // il livello r comprende i pixel del suo colore e di tutti quelli disegnati dopo (sopra) di lui
    const mask = new Uint8Array(W2 * H2);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const l = labels[y * w + x];
        if (l !== TRACE_TRANSPARENT && rank[l] >= r) mask[(y + 1) * W2 + x + 1] = 1;
      }
    }
    const d = traceMask(mask, W2, H2, eps, minArea);
    if (d) paths.push(`<path fill="${traceHex(q.palette[order[r]])}" fill-rule="evenodd" d="${d}"/>`);
    if (onProgress) onProgress(r + 1, order.length);
    await traceTick();
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${w} ${h}">\n`
    + paths.join('\n') + `\n</svg>\n`;
}
