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

    // Switch to Mansion + start round (so tower teleports exist)
    await page.evaluate(async () => {
      try {
        if (window.__socket && window.__socket.readyState === 1) {
          window.__socket.send(JSON.stringify({ t:'setMap', mapId:'mansion' }));
          window.__socket.send(JSON.stringify({ t:'start' }));
          return;
        }
      } catch {}
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

    // Teleport shooter to tower base, press tower up, then aim down for screenshot
    await page.evaluate(async (fromId) => {
      const post = (path, body) => fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      try {
        // Move to tower base (mansion)
        await post('/debug/teleport', { id: fromId, x: -18.0, y: 1.8, z: 18.0, yaw: 0, pitch: 0 });
      } catch {}
      try {
        if (window.__socket && window.__socket.readyState === 1) {
          window.__socket.send(JSON.stringify({ t:'teleport', id:'tower_up' }));
        }
      } catch {}
      try {
        // After teleport, adjust aim to look down a bit
        await post('/debug/teleport', { id: fromId, x: -18.0, y: 24.0, z: 18.0, yaw: 0, pitch: -0.75 });
      } catch {}
    }, shooterId);

    // Let state + camera settle
    await sleep(450);

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
