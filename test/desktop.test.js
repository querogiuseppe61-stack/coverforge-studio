/* Lanciatore Linux dai sorgenti (install-desktop.sh): l'icona indicata nel file .desktop deve esistere,
   anche con spazi nel percorso. Lo script gira su una copia, con una HOME finta. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

test('install-desktop.sh: icona esistente, menu e scrivania', { skip: process.platform === 'win32' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coverforge-desktop-'));
  const app = path.join(tmp, 'Cartella con spazi');
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  fs.mkdirSync(app);
  fs.copyFileSync(path.join(ROOT, 'install-desktop.sh'), path.join(app, 'install-desktop.sh'));
  fs.cpSync(path.join(ROOT, 'assets'), path.join(app, 'assets'), { recursive: true });
  try {
    const r = spawnSync('bash', [path.join(app, 'install-desktop.sh'), '--menu', '--desktop'], {
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') }, encoding: 'utf8'
    });
    assert.equal(r.status, 0, r.stderr);
    for (const f of [path.join(app, 'coverforge-studio.desktop'),
      path.join(home, '.local/share/applications/coverforge-studio.desktop'),
      path.join(home, 'Desktop/coverforge-studio.desktop')]) {
      const icon = (fs.readFileSync(f, 'utf8').match(/^Icon=(.+)$/m) || [])[1];
      assert.ok(icon && fs.existsSync(icon), `icona mancante in ${f}: ${icon}`);
    }
    assert.notEqual(spawnSync('bash', [path.join(app, 'install-desktop.sh'), '--boh'], { env: { ...process.env, HOME: home } }).status, 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
