/* Test del server: API, database, costi, formato e controlli di sicurezza,
   con un finto OpenRouter (test/helpers/fake-openrouter.js). Eseguire con `npm test`. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { startServer, makePng } = require('./helpers/env');

let srv;
before(async () => { srv = await startServer({ env: { OPENROUTER_API_KEY: 'sk-test' } }); });
after(async () => { await srv?.stop(); });

const api = async (path, { method = 'GET', body, form } = {}) => {
  const r = await fetch(srv.url + path, {
    method, body: form || (body ? JSON.stringify(body) : undefined),
    headers: body ? { 'Content-Type': 'application/json' } : undefined
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};
const pngDataUrl = (w = 40, h = 30, c) => 'data:image/png;base64,' + makePng(w, h, c).toString('base64');
const upload = (name, buf, type = 'application/octet-stream') => {
  const fd = new FormData(); fd.append('file', new Blob([buf], { type }), name);
  return api('/api/ref-files/upload', { method: 'POST', form: fd });
};

/* richiesta con un Host arbitrario (fetch non permette di cambiarlo) */
const rawGet = (path, host) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.port, path, headers: { host } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
});

test('health e chiave del server', async () => {
  const r = await api('/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, hasServerKey: true });
});

test('blocca Host estranei (DNS rebinding) e origini estranee', async () => {
  assert.equal(await rawGet('/api/health', 'evil.example:80'), 403);
  const r = await fetch(srv.url + '/api/history', { method: 'DELETE', headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

test('elenco modelli: testo e immagini separati, vista segnalata', async () => {
  const r = await api('/api/models');
  assert.equal(r.status, 200);
  assert.ok(r.json.image.some((m) => m.id === 'google/gemini-3-pro-image-preview'));
  assert.equal(r.json.text.find((m) => m.id === 'deepseek/deepseek-chat').vision, false);
  assert.equal(r.json.text.find((m) => m.id === 'anthropic/claude-sonnet-5').vision, true);
});

test('verifica connessione: rete e chiave', async () => {
  const r = await api('/api/check');
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.steps.map((s) => [s.id, s.ok]), [['rete', true], ['chiave', true]]);
  assert.equal(r.json.steps[1].credit.account, null);   // /credits risponde 403 con una chiave normale
});

test('craft restituisce testo e costo', async () => {
  const r = await api('/api/craft', { method: 'POST', body: { model: 'x/text', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }] } });
  assert.equal(r.status, 200);
  assert.equal(r.json.cost, 0.00213);
  assert.equal(JSON.parse(r.json.content).concept.length > 0, true);
});

test('craft rifiuta messaggi non validi', async () => {
  const r = await api('/api/craft', { method: 'POST', body: { model: 'x', messages: [{ role: 'tool', content: 'x' }] } });
  assert.equal(r.status, 400);
});

test('generate: image_config per i formati ammessi, non per gli altri', async () => {
  srv.clearRequests();
  let r = await api('/api/generate', { method: 'POST', body: { model: 'x/ok', prompt: 'p', aspectRatio: '16:9' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.aspect, 'inviato');
  assert.equal(r.json.cost, 0.039);
  r = await api('/api/generate', { method: 'POST', body: { model: 'x/ok', prompt: 'p', aspectRatio: '1.91:1' } });
  assert.equal(r.json.aspect, 'no');
  const sent = srv.requests('/chat/completions').map((x) => x.image_config);
  assert.deepEqual(sent, [{ aspect_ratio: '16:9' }, null]);
});

test('generate: se il modello rifiuta image_config si riprova senza', async () => {
  srv.clearRequests();
  const r = await api('/api/generate', { method: 'POST', body: { model: 'x/strict', prompt: 'p', aspectRatio: '2:3' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.aspect, 'rifiutato');
  assert.deepEqual(srv.requests('/chat/completions').map((x) => x.image_config), [{ aspect_ratio: '2:3' }, null]);
});

test('generate: riferimenti consentiti solo se registrati', async () => {
  const r = await api('/api/generate', { method: 'POST', body: { model: 'x/ok', prompt: 'p', referenceImages: ['/uploads/non-esiste.png'] } });
  assert.equal(r.status, 400);
  const r2 = await api('/api/generate', { method: 'POST', body: { model: 'x/ok', prompt: 'p', referenceImages: ['file:///etc/passwd'] } });
  assert.equal(r2.status, 400);
});

test('upload: contenuto controllato, testo estratto, riferimento usabile', async () => {
  const bad = await upload('finta.png', Buffer.from('non sono un png'));
  assert.equal(bad.status, 400);
  const txt = await upload('articolo.txt', Buffer.from('Un articolo breve.\nFine.'));
  assert.equal(txt.status, 200);
  assert.equal(txt.json.text_extracted, true);
  const t = await api(`/api/ref-files/${txt.json.id}/text?limit=1000`);
  assert.match(t.json.text, /Fine\./);
  const img = await upload('esempio.png', makePng(20, 20));
  assert.equal(img.json.file_type, 'image');
  srv.clearRequests();
  const g = await api('/api/generate', { method: 'POST', body: { model: 'x/ok', prompt: 'p', referenceImages: [`/uploads/${img.json.stored_name}`] } });
  assert.equal(g.status, 200);
  const parts = srv.requests('/chat/completions')[0].messages[0].content;
  assert.equal(parts[0].type, 'image_url');   // l'immagine viene letta dal disco e inviata come data URL
  assert.match(parts[0].url, /^\[data:/);
});

test('upload: estratto di un testo lungo con inizio, metà e fine', async () => {
  const long = 'INIZIO ' + 'a'.repeat(20000) + ' METÀ ' + 'b'.repeat(20000) + ' FINE';
  const r = await upload('lungo.md', Buffer.from(long));
  const t = await api(`/api/ref-files/${r.json.id}/text?limit=2000`);
  assert.equal(t.json.sampled, true);
  assert.match(t.json.text, /^INIZIO/);
  assert.match(t.json.text, /FINE$/);
});

test('cronologia: salvataggio, costo, preferita, versioni e cancellazione', async () => {
  const a = await api('/api/history', { method: 'POST', body: { category: 'libro', ratio: '2:3', image: pngDataUrl(), cost: 0.041 } });
  assert.equal(a.status, 200);
  const b = await api('/api/history', { method: 'POST', body: { category: 'libro', ratio: '2:3', image: pngDataUrl(), parent_id: a.json.id } });
  const bogus = await api('/api/history', { method: 'POST', body: { category: 'libro', image: pngDataUrl(), parent_id: 999999, cost: -1 } });
  let list = (await api('/api/history')).json;
  const row = (id) => list.find((r) => r.id === id);
  assert.equal(row(a.json.id).cost, 0.041);
  assert.equal(row(b.json.id).parent_id, a.json.id);
  assert.equal(row(bogus.json.id).parent_id, null);   // la riga di partenza deve esistere
  assert.equal(row(bogus.json.id).cost, null);        // costi negativi scartati

  const img = await fetch(srv.url + row(a.json.id).image_url);
  assert.equal(img.headers.get('content-type'), 'image/png');

  assert.equal((await api(`/api/history/${a.json.id}/favorite`, { method: 'POST', body: { favorite: true } })).status, 200);
  assert.equal((await api('/api/history/999999/favorite', { method: 'POST', body: { favorite: true } })).status, 404);

  await api(`/api/history/${a.json.id}`, { method: 'DELETE' });
  list = (await api('/api/history')).json;
  assert.equal(row(b.json.id).parent_id, null);   // la versione resta, senza collegamento
});

test('cronologia: categoria e immagine validate (niente SVG)', async () => {
  assert.equal((await api('/api/history', { method: 'POST', body: { category: 'virus', image: pngDataUrl() } })).status, 400);
  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg onload="alert(1)"/>').toString('base64');
  assert.equal((await api('/api/history', { method: 'POST', body: { category: 'logo', image: svg } })).status, 400);
  assert.equal((await api('/api/history', { method: 'POST', body: { category: 'blog', image: pngDataUrl() } })).status, 200);
});

test('profilo di stile: archivio, modifica a mano, analisi', async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await upload(`stile${i}.png`, makePng(10, 10, [i * 60, 50, 50]))).json.id);
  for (const id of ids) assert.equal((await api(`/api/ref-files/${id}/style`, { method: 'POST', body: { style: true } })).status, 200);
  let p = (await api('/api/style-profile')).json;
  assert.equal(p.archive.examples, 3);

  await api('/api/style-profile', { method: 'PUT', body: { text: 'Palette: scritta a mano' } });
  p = (await api('/api/style-profile')).json;
  assert.equal(p.text, 'Palette: scritta a mano');
  assert.equal(p.auto, false);

  assert.equal((await api('/api/style-profile/build', { method: 'POST', body: { model: 'x', images: [pngDataUrl()] } })).status, 400);
  assert.equal((await api('/api/style-profile/build', { method: 'POST', body: { model: 'x', images: ['javascript:1', 'b', 'c'] } })).status, 400);
  const jpeg = 'data:image/jpeg;base64,/9j/AAA=';
  const b = await api('/api/style-profile/build', { method: 'POST', body: { model: 'x/v', images: [jpeg, jpeg, jpeg], sources: ['r1', 'h2', 'bad!'] } });
  assert.equal(b.status, 200);
  assert.match(b.json.text, /acquerello/);
  assert.equal(b.json.cost, 0.00213);
  p = (await api('/api/style-profile')).json;
  assert.equal(p.auto, true);
  assert.deepEqual(p.sources, ['r1', 'h2']);   // chiavi non valide scartate
});

test('guida per il prompt: sezioni per tipo di progetto', async () => {
  const s = (await api('/api/prompt-guide')).json.sections;
  for (const k of ['generale', 'libro', 'blog', 'modifica', 'testo', 'senza-testo', 'riferimenti']) assert.ok(s[k], `manca la sezione ${k}`);
});

test('endpoint sconosciuti e JSON malformato rispondono in JSON', async () => {
  const r = await api('/api/nulla');
  assert.equal(r.status, 404);
  assert.ok(r.json.error);
  const bad = await fetch(srv.url + '/api/craft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{rotto' });
  assert.equal(bad.status, 400);
  assert.ok((await bad.json()).error);
});

test('la chiave API si accetta solo nell\'intestazione, non nel corpo', async () => {
  const bare = await startServer();   // server senza chiave in .env
  try {
    const call = (headers, body) => fetch(bare.url + '/api/craft', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'u' }], ...body })
    });
    assert.equal((await call({}, { key: 'sk-nel-corpo' })).status, 401);
    assert.equal((await call({ 'x-or-key': 'sk-intestazione' }, {})).status, 200);
  } finally { await bare.stop(); }
});
