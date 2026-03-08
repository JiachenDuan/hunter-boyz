const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function main() {
  const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

  // Make this smoke test self-contained by default: spin up our server on a free-ish port,
  // run the browser checks, then tear it down.
  const externalUrl = process.env.GAME_URL;
  const port = Number(process.env.PORT || 3130);
  const url = externalUrl || `http://127.0.0.1:${port}/?v=smoke`;

  let serverProc = null;
  if (!externalUrl) {
    const serverPath = path.join(__dirname, '..', 'server.js');
    serverProc = spawn(process.execPath, [serverPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(port) },
    });

    const serverLogs = [];
    const onData = (chunk) => {
      const s = chunk.toString('utf8');
      serverLogs.push(s);
      if (serverLogs.length > 50) serverLogs.shift();
    };
    serverProc.stdout.on('data', onData);
    serverProc.stderr.on('data', onData);

    // Wait for server to accept connections.
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
        if (res.status === 200 || res.status === 302) break;
      } catch (e) {
        // ignore
      }
      await sleep(150);
    }

    // Quick sanity for common Safari probe endpoints (prevents noisy 404s + ensures server handlers stay intact).
    {
      const base = new URL(url);
      base.search = '';
      base.hash = '';

      const probePaths = [
        '/apple-touch-icon.png',
        '/apple-touch-icon-precomposed.png',
        '/robots.txt',
        '/site.webmanifest',
        '/manifest.webmanifest',
      ];

      for (const p of probePaths) {
        const probeUrl = new URL(p, base).toString();
        const res = await fetch(probeUrl, { method: 'GET' });
        if (!(res.status === 204 || res.status === 200)) {
          const tail = serverLogs.join('').slice(-2000);
          throw new Error(`Static probe failed: ${probeUrl} (status ${res.status})\n--- server tail ---\n${tail}`);
        }
      }
    }
  }

  if (!fs.existsSync(chromePath)) throw new Error('Chrome not found: ' + chromePath);

  let browser = null;
  const errors = [];

  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

    page.on('console', (msg) => {
      const t = msg.type();
      if (t === 'error') {
        const txt = msg.text();
        // Ignore noisy missing favicon or similar static 404s.
        if (/favicon\.ico/i.test(txt)) return;
        // Chrome sometimes logs a generic 404 with no URL; ignore.
        if (/status of 404/i.test(txt) && !/http/i.test(txt)) return;
        errors.push('console.error: ' + txt);
      }
    });
    page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  // Open settings panel (ensure visible)
  await page.evaluate(() => {
    document.getElementById('settingsPanel').style.display = 'block';
  });

  // Join
  await page.evaluate(() => {
    document.getElementById('name').value = 'Smoke';
  });
  await page.evaluate(() => {
    const b = document.getElementById('joinBtn');
    if (b) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await sleep(900);

  // Weapon picker opens
  await page.evaluate(() => {
    const el = document.getElementById('btnWeaponPick');
    if (el) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await sleep(150);
  // Pick Rocket
  await page.evaluate(() => {
    const opt = document.querySelector('#weaponModalInner .wm-opt[data-weapon="rocket"]');
    if (opt) opt.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await sleep(200);

  // Switch to Sniper and try scope
  await page.evaluate(() => {
    const w = document.getElementById('weapon');
    w.value = 'sniper';
    w.dispatchEvent(new Event('change'));
  });
  await sleep(100);
  await page.evaluate(() => {
    const el = document.getElementById('btnScope');
    // Scope toggle is pointerdown-only (avoids iOS double events); mirror that here.
    if (el) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });

  await sleep(100);

    // Ensure no hard errors
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (serverProc) {
      serverProc.kill('SIGTERM');
      await sleep(150);
      if (!serverProc.killed) serverProc.kill('SIGKILL');
    }
  }

  const ok = errors.length === 0;
  console.log(JSON.stringify({ ok, errors }, null, 2));
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
