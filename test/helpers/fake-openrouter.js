/* Finto OpenRouter per i test: si carica con `node -r` prima di server.js e sostituisce fetch
   solo per gli indirizzi di openrouter.ai. Ogni richiesta finisce in FAKE_OR_LOG (una riga JSON),
   con le immagini ridotte a un segnaposto. Comportamenti:
   - /models: un elenco fisso di modelli (FAKE_MODELS);
   - /key: chiave valida; /credits: 403 (come per una chiave normale);
   - chat con modalities (generazione): restituisce FAKE_PNG, costo 0.039;
     il modello «x/strict» rifiuta image_config con un 400;
   - chat di testo: per il profilo di stile un testo, altrimenti un JSON con tutti i campi che l'app chiede. */
const fs = require('fs');

const LOG = process.env.FAKE_OR_LOG;
const PNG = 'data:image/png;base64,' + fs.readFileSync(process.env.FAKE_PNG).toString('base64');
const real = globalThis.fetch;

const M = (id, vision, image) => ({ id, name: id, architecture: {
  input_modalities: vision ? ['text', 'image'] : ['text'], output_modalities: image ? ['image', 'text'] : ['text'] } });
const FAKE_MODELS = [
  M('google/gemini-2.5-flash', true), M('google/gemini-3-flash', true), M('google/gemini-3-flash:free', true),
  M('google/gemini-3-pro', true), M('anthropic/claude-sonnet-4.5', true), M('anthropic/claude-sonnet-5', true),
  M('deepseek/deepseek-chat', false), M('openai/gpt-5-mini', true),
  M('google/gemini-2.5-flash-image', true, true), M('google/gemini-3-flash-image-preview', true, true),
  M('google/gemini-3-pro-image-preview', true, true), M('openai/gpt-5-image', true, true), M('x/strict', false, true)
];

const TEXT_REPLY = {
  articolo: { argomento: 'Il diritto a disconnettersi', tono: 'intimo', spirito: 'sollievo' },
  ovvie: ['telefono spento', 'orologio'], concept: 'Una tazza ancora calda accanto a un telefono capovolto',
  prompt: 'A still warm cup beside a phone turned face down, soft evening light.',
  ideas: [{ title: 'Tazza', concept: 'Una tazza accanto a un telefono capovolto' }],
  cambia: 'la luce diventa notturna', conserva: 'soggetto e composizione'
};
const STYLE_REPLY = 'Tecnica e medium: acquerello\nPalette: terrosa con un accento arancio';

const strip = (v) => (typeof v === 'string' && v.startsWith('data:') ? `[data:${v.length}]` : v);
function record(url, body) {
  if (!LOG) return;
  const messages = (body?.messages || []).map((m) => ({
    role: m.role,
    content: Array.isArray(m.content) ? m.content.map((p) => (p.type === 'image_url' ? { type: 'image_url', url: strip(p.image_url?.url) } : p)) : m.content
  }));
  fs.appendFileSync(LOG, JSON.stringify({ path: new URL(url).pathname.replace('/api/v1', ''), model: body?.model,
    modalities: body?.modalities || null, image_config: body?.image_config || null, messages }) + '\n');
}

const json = (status, j) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (url, opts = {}) => {
  if (!String(url).startsWith('https://openrouter.ai')) return real(url, opts);
  const body = opts.body ? JSON.parse(opts.body) : null;
  record(String(url), body);
  const path = new URL(String(url)).pathname;
  if (path.endsWith('/models')) return json(200, { data: FAKE_MODELS });
  if (path.endsWith('/key')) return json(200, { data: { limit: null, usage: 1.5, is_free_tier: false } });
  if (path.endsWith('/credits')) return json(403, { error: { message: 'management key required' } });
  if (body?.modalities) {
    if (body.model === 'x/strict' && body.image_config) return json(400, { error: { message: 'image_config not supported' } });
    return json(200, { choices: [{ message: { content: '', images: [{ image_url: { url: PNG } }] } }], usage: { cost: 0.039 } });
  }
  const system = typeof body?.messages?.[0]?.content === 'string' ? body.messages[0].content : '';
  const content = system.includes('Descrivi lo STILE') ? STYLE_REPLY : JSON.stringify(TEXT_REPLY);
  return json(200, { choices: [{ message: { content } }], usage: { cost: 0.00213 } });
};
