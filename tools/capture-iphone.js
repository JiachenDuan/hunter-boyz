const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function main(){
  const outDir = path.join(__dirname, '..', 'snaps');
  fs.mkdirSync(outDir, { recursive: true });

  const url = process.env.GAME_URL || 'http://127.0.0.1:3030';
  const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!fs.existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
  });

  try {
    // Page 1: iPhone (the screenshot)
    const page = await browser.newPage();

    // iPhone 14-ish viewport
    await page.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/121.0.0.0 Mobile/15E148 Safari/604.1');

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Join so UI is in the real in-game state
    await page.evaluate(() => {
      document.getElementById('settingsPanel').style.display = 'block';
      document.getElementById('name').value = 'iPhoneTest';
    });
    await page.evaluate(() => document.getElementById('joinBtn').dispatchEvent(new Event('click', { bubbles: true })));

    // Page 2: a victim bot so we can reliably trigger HIT/KILL UI for the screenshot
    const bot = await browser.newPage();
    await bot.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });
    await bot.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await bot.evaluate(() => {
      document.getElementById('settingsPanel').style.display = 'block';
      document.getElementById('name').value = 'Bot';
    });
    await bot.evaluate(() => document.getElementById('joinBtn').dispatchEvent(new Event('click', { bubbles: true })));

    // Wait for ids to appear (we expose window.__myId in app.js)
    async function waitForId(p) {
      for (let i = 0; i < 60; i++) {
        const id = await p.evaluate(() => window.__myId || null);
        if (id) return String(id);
        await sleep(100);
      }
      throw new Error('Timed out waiting for player id');
    }

    const shooterId = await waitForId(page);
    const botId = await waitForId(bot);

    // Start the round (localhost-only debug endpoint)
    await page.evaluate(async () => {
      try { await fetch('/debug/start', { method: 'POST' }); } catch {}
    });

    // Wait until the round actually starts (server state says started)
    try {
      await page.waitForFunction(() => {
        const s = window.__lastState;
        return !!(s && s.game && s.game.started);
      }, { timeout: 8000 });
    } catch {}

    // Also wait until the round timer is no longer showing LOBBY (i.e., countdown is live)
    try {
      await page.waitForFunction(() => {
        const el = document.getElementById('roundTimer');
        const t = (el && el.textContent || '').trim();
        return t && t !== 'LOBBY';
      }, { timeout: 8000 });
    } catch {}

    // Belt + suspenders: hide lobby overlay if it’s still visible for any reason
    await page.evaluate(() => {
      const l = document.getElementById('lobby');
      if (l) l.style.display = 'none';
      // Make it obvious this is an in-match capture
      const badge = document.getElementById('__captureBadge') || (() => {
        const d = document.createElement('div');
        d.id = '__captureBadge';
        d.textContent = 'CAPTURE';
        d.style.position = 'fixed';
        d.style.left = '10px';
        d.style.bottom = '10px';
        d.style.zIndex = '99999';
        d.style.fontWeight = '900';
        d.style.fontSize = '12px';
        d.style.padding = '6px 10px';
        d.style.borderRadius = '999px';
        d.style.background = 'rgba(0,0,0,0.55)';
        d.style.border = '1px solid rgba(255,255,255,0.18)';
        d.style.color = 'rgba(230,237,243,0.9)';
        document.body.appendChild(d);
        return d;
      })();
      badge.style.display = 'block';
    });

    // Put them in a known line-up: shooter looks +Z, bot stands in front
    const shooter = { id: shooterId, x: 0, y: 1.8, z: 0, yaw: 0, pitch: 0, hp: 100 };
    const victim = { id: botId, x: 0, y: 1.8, z: 6, yaw: Math.PI, pitch: 0, hp: 100 };

    await page.evaluate(async (a, b) => {
      const post = (path, body) => fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      try { await post('/debug/teleport', a); } catch {}
      try { await post('/debug/teleport', b); } catch {}
    }, shooter, victim);

    // Fire enough debug shots to guarantee a kill and trigger HIT/KILL banners
    for (let i = 0; i < 4; i++) {
      await page.evaluate(async (fromId) => {
        try {
          await fetch('/debug/shoot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fromId }),
          });
        } catch {}
      }, shooterId);
      await sleep(120);
    }

    // Let UI animations render
    await sleep(300);

    const ts = Date.now();
    const file = path.join(outDir, `iphone-${ts}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(JSON.stringify({ file }, null, 2));

    try { await bot.close(); } catch {}
  } finally {
    await browser.close();
  }
}

main().catch((e)=>{ console.error(e); process.exit(1); });
