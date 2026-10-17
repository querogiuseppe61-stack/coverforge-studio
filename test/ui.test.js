/* Test dell'interfaccia in Chromium (Playwright), con server vero e finto OpenRouter.
   Ogni test ha il suo server e il suo database. Eseguire con `npm test`
   (la prima volta: `npx playwright install chromium`). */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makePng } = require('./helpers/env');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* Playwright non installato: test saltati */ }

let browser;
before(async () => { if (chromium) browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

/* Scelte già fatte (benvenuto chiuso, modelli scelti) salvo diversa indicazione */
const DEFAULT_UI = { welcomeDone: true, textModel: 'anthropic/claude-sonnet-5', imageModel: 'google/gemini-3-pro-image-preview', cat: 'libro' };

async function withApp(ui, fn) {
  const srv = await startServer({ env: { OPENROUTER_API_KEY: 'sk-test' } });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  if (ui) await ctx.addInitScript((v) => { if (!localStorage.getItem('cf_ui')) localStorage.setItem('cf_ui', v); }, JSON.stringify(ui));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(srv.url + '/');
    await page.waitForFunction(() => document.querySelectorAll('#imageModel option').length > 0);
    await fn(page, srv);
    assert.deepEqual(errors, [], 'errori JavaScript nella pagina');
  } finally {
    await ctx.close();
    await srv.stop();
  }
}

const until = async (fn, what, ms = 10000) => {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > ms) throw new Error('Tempo scaduto: ' + what);
    await new Promise((r) => setTimeout(r, 100));
  }
};
const logText = (page) => page.textContent('#log');
const lastGenerate = (srv) => srv.requests('/chat/completions').filter((r) => r.modalities).at(-1);
const lastCraft = (srv) => srv.requests('/chat/completions').filter((r) => !r.modalities).at(-1);
const pngFile = (name, w, h, c) => ({ name, mimeType: 'image/png', buffer: makePng(w, h, c) });
const T = { timeout: 60000, skip: !chromium && 'Playwright non installato' };

test('primo avvio: benvenuto, combinazioni di modelli, scelta applicata', T, () => withApp(null, async (page) => {
  await until(() => page.$eval('#welcome', (d) => d.open), 'finestra di benvenuto');
  await until(async () => (await page.locator('#wModels label').count()) === 3, 'combinazioni di modelli');
  const texts = (await page.locator('#wModels label').allTextContents()).join(' | ');
  assert.match(texts, /testo: google\/gemini-3-flash 👁 · immagini: google\/gemini-3-flash-image-preview/);
  assert.match(texts, /testo: anthropic\/claude-sonnet-5 👁 · immagini: google\/gemini-3-pro-image-preview/);
  assert.doesNotMatch(texts, /:free/);
  assert.equal(await page.inputValue('#textModel'), 'google/gemini-3-flash');   // predefinito: Economica

  await page.fill('#wKey', 'sk-or-v1-prova');
  await page.click('#wCheck');
  await until(async () => /Chiave valida/.test(await page.textContent('#wCheckResult')), 'verifica della chiave');

  await page.check('input[name=wPreset][value=qualita]');
  await page.click('#wDone');
  assert.equal(await page.$eval('#welcome', (d) => d.open), false);
  assert.equal(await page.inputValue('#textModel'), 'anthropic/claude-sonnet-5');
  assert.equal(await page.inputValue('#imageModel'), 'google/gemini-3-pro-image-preview');

  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#imageModel option').length > 0);
  assert.equal(await page.$eval('#welcome', (d) => d.open), false);
}));

test('costi: registro, badge e cronologia', T, () => withApp(DEFAULT_UI, async (page) => {
  await page.fill('#brief', 'faro al tramonto');
  await page.click('#btnGo');
  await until(async () => (await page.locator('.hist-item').count()) === 1, 'immagine in cronologia');
  assert.equal(await page.textContent('#costBadge'), '💳 $0.041');
  assert.match(await logText(page), /💳 testo: \$0\.0021/);
  assert.match(await logText(page), /💳 immagine: \$0\.039/);
  assert.match(await page.locator('.hist-item .meta').first().textContent(), /\$0\.041/);
}));

test('blog: l\'articolo intero arriva al modello e la lettura compare', T, () => withApp(DEFAULT_UI, async (page, srv) => {
  const article = 'Perché ho smesso di rispondere alle email dopo le sei.\n' + 'Per anni ho creduto che la reperibilità fosse una virtù. '.repeat(200) + '\nNoi, forse, no.';
  await page.setInputFiles('#refFileInput', { name: 'articolo.txt', mimeType: 'text/plain', buffer: Buffer.from(article) });
  await page.waitForSelector('#refList input[data-name="articolo.txt"]');
  await page.check('#refList input[data-name="articolo.txt"]');
  await page.click('.cat:has-text("Blog")');
  assert.deepEqual(await page.$$eval('#ratio option', (o) => o.map((x) => x.value)), ['16:9', '3:2', '1.91:1', '4:3', '1:1']);
  await page.check('#approveIdea');
  await page.fill('#brief', 'colori caldi');
  await page.click('#btnGo');
  await page.waitForSelector('#approvalBox:not(.hidden)');
  assert.match(await page.textContent('#approvalArticle'), /Argomento: Il diritto a disconnettersi · Tono: intimo · Spirito: sollievo/);
  const system = lastCraft(srv).messages[0].content;
  assert.ok(system.includes('Noi, forse, no.'), 'l\'articolo deve arrivare fino alla chiusa');
  assert.ok(!system.includes('passaggio omesso'), 'l\'articolo non deve essere campionato');
  assert.ok(system.includes('"articolo":{"argomento"'), 'schema con la lettura dell\'articolo');
  assert.equal(srv.requests('/chat/completions').filter((r) => r.modalities).length, 0, 'con la conferma non si genera');
}));

test('il mio stile: archivio, profilo e uso nel prompt', T, () => withApp(DEFAULT_UI, async (page, srv) => {
  await page.setInputFiles('#refFileInput', [pngFile('a.png', 30, 20, [200, 80, 40]), pngFile('b.png', 30, 20, [60, 120, 90]), pngFile('c.png', 30, 20, [30, 30, 60])]);
  await until(async () => (await page.locator('.ref-style').count()) === 3, 'tre immagini allegate');
  for (let i = 0; i < 3; i++) { await page.locator('.ref-style').nth(i).click(); await page.waitForTimeout(100); }
  await until(async () => /3 esempi/.test(await page.textContent('#styleStatus')), 'archivio di 3 esempi');
  await page.click('#btnStyleBuild');
  await until(async () => /acquerello/.test(await page.inputValue('#styleProfile')), 'profilo di stile');
  const build = srv.requests('/chat/completions').find((r) => typeof r.messages[0].content === 'string' && r.messages[0].content.includes('Descrivi lo STILE'));
  assert.equal(build.messages[1].content.filter((p) => p.type === 'image_url').length, 3);

  await page.check('#useStyle');
  await page.click('.cat:has-text("Logo")');
  await page.fill('#brief', 'logo per una panetteria');
  await page.click('#btnGo');
  await until(async () => (await page.locator('.hist-item').count()) === 1, 'immagine generata');
  const system = lastCraft(srv).messages[0].content;
  assert.ok(system.includes('STILE PREFERITO DELL\'UTENTE'));
  assert.ok(system.includes('acquerello'));
  assert.ok(system.includes('Per un logo applica del profilo solo palette'));
}));

test('modifica: istruzione dall\'LLM, prima/dopo, versione in cronologia', T, () => withApp(DEFAULT_UI, async (page, srv) => {
  await page.fill('#promptOut', 'a lighthouse at dusk');
  await page.click('#btnGen');
  await until(async () => (await page.locator('.hist-item').count()) === 1, 'prima immagine');
  assert.equal(await page.isDisabled('#btnCompare'), true);

  await page.selectOption('#quickEdit', { index: 1 });
  assert.match(await page.inputValue('#refineTxt'), /notte/);
  await page.click('#btnRefine');
  await until(async () => (await page.locator('.hist-item').count()) === 2, 'immagine modificata');
  assert.match(await logText(page), /✎ Cambia: la luce diventa notturna · Resta: soggetto e composizione/);
  const gen = lastGenerate(srv);
  const parts = gen.messages[0].content;
  assert.equal(parts.filter((p) => p.type === 'image_url').length, 1, 'l\'immagine di partenza va al generatore');
  assert.match(parts.at(-1).text, /^A still warm cup/, 'l\'istruzione è quella scritta dall\'LLM');
  assert.deepEqual(gen.image_config, { aspect_ratio: '4:3' }, 'la modifica conserva le proporzioni');

  await page.click('#btnCompare');
  assert.equal(await page.locator('.compare-overlay').count(), 1);
  await page.click('#btnPrev');
  assert.equal(await page.locator('.compare-overlay').count(), 0);
  assert.equal(await page.isDisabled('#btnCompare'), true);

  await page.reload();
  await page.waitForSelector('.hist-item');
  const first = page.locator('.hist-item .meta').first();
  assert.match(await first.textContent(), /✎ versione/);
  await first.click();
  assert.equal(await page.isDisabled('#btnCompare'), false, 'il collegamento sopravvive al ricaricamento');
}));

test('nuovo formato: tela allargata, parametro di formato, ritaglio esatto', T, () => withApp(DEFAULT_UI, async (page, srv) => {
  await page.setInputFiles('#openImgInput', pngFile('scena.png', 400, 300, [40, 90, 200]));
  await page.waitForSelector('#stage img');
  await page.selectOption('#reformatRatio', '16:9');
  await page.click('#btnReformat');
  await until(async () => (await page.locator('.hist-item').count()) === 1, 'immagine nel nuovo formato');
  const gen = lastGenerate(srv);
  assert.deepEqual(gen.image_config, { aspect_ratio: '16:9' });
  assert.match(gen.messages[0].content.at(-1).text, /left and right/);
  // il finto generatore risponde 400×300: l'app ritaglia al centro a 16:9
  const size = await page.$eval('#stage img', (i) => [i.naturalWidth, i.naturalHeight]);
  assert.deepEqual(size, [400, 225]);
  assert.match(await logText(page), /ritaglio al centro/);
  assert.match(await page.locator('.hist-item .meta').first().textContent(), /16:9/);
}));

test('zona: copia segnata in rosso e frase nel prompt', T, () => withApp(DEFAULT_UI, async (page, srv) => {
  await page.setInputFiles('#openImgInput', pngFile('scena.png', 400, 300, [240, 200, 60]));
  await page.waitForSelector('#stage img');
  await page.click('#btnZone');
  const canvas = page.locator('.zone-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const b = await canvas.boundingBox();
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.5, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.isDisabled('#btnZoneClear'), false);
  await page.click('#btnZone');
  await page.fill('#refineTxt', 'trasforma il sole in luna');
  await page.click('#btnRefine');
  await until(async () => (await page.locator('.hist-item').count()) === 1, 'immagine modificata');
  const parts = lastGenerate(srv).messages[0].content;
  assert.equal(parts.filter((p) => p.type === 'image_url').length, 2, 'originale + copia segnata');
  assert.match(parts.at(-1).text, /tinted and outlined in red/);
  const system = lastCraft(srv).messages[0].content;
  assert.ok(system.includes('segnato in rosso'), 'l\'LLM sa della zona');
}));

test('modello che rifiuta il formato: si rigenera senza e si avvisa', T, () => withApp(DEFAULT_UI, async (page, srv) => {
  await page.selectOption('#imageModel', 'x/strict');
  await page.fill('#promptOut', 'a cover');
  await page.click('#btnGen');
  await until(async () => (await page.locator('.hist-item').count()) === 1, 'immagine generata');
  assert.match(await logText(page), /non accetta il parametro di formato/);
  const gens = srv.requests('/chat/completions').filter((r) => r.modalities);
  assert.deepEqual(gens.map((g) => g.image_config), [{ aspect_ratio: '2:3' }, null]);
}));
