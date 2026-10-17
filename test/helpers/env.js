/* Avvio di un server CoverForge isolato per i test: cartella dati temporanea, porta libera,
   finto OpenRouter (fake-openrouter.js) e immagini PNG generate al volo. */
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');

/* PNG RGB a tinta unita (o con una funzione pixel → [r,g,b]) senza dipendenze */
function makePng(w, h, color = [200, 80, 40]) {
  const px = typeof color === 'function' ? color : () => color;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) { const [r, g, b] = px(x, y); row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
    rows.push(row);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.unref(); s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function startServer({ env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverforge-test-'));
  const fakePng = path.join(dir, 'risposta.png');
  fs.writeFileSync(fakePng, makePng(400, 300, [40, 120, 90]));   // il «risultato» del generatore: 4:3
  const logFile = path.join(dir, 'openrouter.jsonl');
  const port = await freePort();
  const proc = spawn(process.execPath, ['-r', path.join(__dirname, 'fake-openrouter.js'), path.join(ROOT, 'server.js')], {
    cwd: dir,   // niente .env del progetto
    env: { PATH: process.env.PATH, PORT: String(port), DATA_DIR: path.join(dir, 'dati'), FAKE_PNG: fakePng, FAKE_OR_LOG: logFile, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  proc.stdout.on('data', (d) => { output += d; }); proc.stderr.on('data', (d) => { output += d; });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url + '/api/health')).ok) break; } catch {}
    if (proc.exitCode !== null) throw new Error('Il server di prova non è partito:\n' + output);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url, port, dir,
    /* richieste arrivate al finto OpenRouter (filtrabili per percorso) */
    requests(pathEnd) {
      if (!fs.existsSync(logFile)) return [];
      const all = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      return pathEnd ? all.filter((r) => r.path.endsWith(pathEnd)) : all;
    },
    clearRequests() { fs.rmSync(logFile, { force: true }); },
    async stop() {
      if (proc.exitCode === null) { proc.kill('SIGTERM'); await new Promise((r) => proc.once('exit', r)); }
      fs.rmSync(dir, { recursive: true, force: true });
    },
    output: () => output
  };
}

module.exports = { startServer, makePng, ROOT };
