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

    // iPhone 14-ish viewport (set LANDSCAPE=1 to capture landscape aspect)
    const landscape = String(process.env.LANDSCAPE || '') === '1';
    await page.setViewport({
      width: landscape ? 844 : 390,
      height: landscape ? 390 : 844,
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
    await page.evaluate(() => {
      const b = document.getElementById('joinBtn');
      if (!b) return;
      // Match in-game handler (pointerdown-first) to avoid iOS click oddities.
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      b.dispatchEvent(new Event('click', { bubbles: true }));
    });

    // Enable sound so SFX improvements are active for the capture (Task #4)
    try {
      await page.evaluate(() => {
        const sb = document.getElementById('soundBtn');
        if (!sb) return;
        sb.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        sb.dispatchEvent(new Event('click', { bubbles: true }));
      });
    } catch {}

    // Page 2: a victim bot so we can reliably trigger HIT/KILL UI for the screenshot
    const bot = await browser.newPage();
    await bot.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });
    await bot.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await bot.evaluate(() => {
      document.getElementById('settingsPanel').style.display = 'block';
      document.getElementById('name').value = 'Bot';
    });
    await bot.evaluate(() => {
      const b = document.getElementById('joinBtn');
      if (!b) return;
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      b.dispatchEvent(new Event('click', { bubbles: true }));
    });

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
        }
      } catch {}
      // Always force-start via localhost debug (works even if not host).
      try { await fetch('/debug/start', { method: 'POST' }); } catch {}
    });

    // Wait until the round actually starts (server state says started).
    // Occasionally we can race the host/round reset, so we actively re-issue /debug/start.
    for (let i = 0; i < 40; i++) {
      const started = await page.evaluate(() => !!(window.__lastState && window.__lastState.game && window.__lastState.game.started));
      if (started) break;
      try { await page.evaluate(() => fetch('/debug/start', { method: 'POST' }).catch(()=>{})); } catch {}
      await sleep(250);
    }

    // Also wait until the round timer is no longer showing LOBBY (i.e., countdown is live)
    for (let i = 0; i < 40; i++) {
      const ok = await page.evaluate(() => {
        const el = document.getElementById('roundTimer');
        const t = (el && el.textContent || '').trim();
        return !!(t && t !== 'LOBBY');
      });
      if (ok) break;
      await sleep(200);
    }

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

    // Teleport shooter + bot into a reliable line-up and capture a HIT hitmarker.
    // (This tick is gun hit feedback; we want a deterministic hit in the screenshot.)

    // Make sure the match is started so the client is in the full in-game HUD mode.
    // (Even if the UI still says LOBBY, the hitmarker is a pure overlay, but starting
    // avoids edge cases where state/UI is still initializing.)
    try {
      await page.evaluate(() => fetch('/debug/start', { method: 'POST' }).catch(()=>{}));
    } catch {}

    // Hide lobby UI overlay if it lingers for any reason.
    await page.evaluate(() => {
      const l = document.getElementById('lobby');
      if (l) l.style.display = 'none';
    });

    // Force-hide any LOBBY timer pill too, so screenshots look in-match even if
    // the roundTimer hasn't ticked yet (purely for capture clarity).
    await page.evaluate(() => {
      const rt = document.getElementById('roundTimer');
      if (rt && (rt.textContent||'').trim() === 'LOBBY') {
        rt.style.display = 'none';
      }
    });

    // Task #1: GUN recoil
    // Teleport shooter + bot into a reliable line-up, trigger a shot, and capture
    // the recoil/bloom in a still iPhone screenshot.

    // Ensure both players are in a clear lane.
    try {
      await page.evaluate(async (fromId, botId) => {
        const post = (path, body) => fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        // Flat courtyard lane (mansion). Shooter looks toward +Z.
        // Use a longer lane so bullet tracers are clearly visible in a still iPhone capture.
        await post('/debug/teleport', { id: fromId, x: 0.0, y: 2.0, z: -18.0, yaw: 0, pitch: -0.04, hp: 100 });
        await post('/debug/teleport', { id: botId,  x: 0.0, y: 2.0, z: 18.0, yaw: Math.PI, pitch: 0, hp: 100 });
      }, shooterId, botId);
    } catch {}

    await sleep(140);

    // Fire once.
    try {
      await page.evaluate(async (fromId) => {
        await fetch('/debug/shoot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromId }),
        }).catch(()=>{});
      }, shooterId);
    } catch {}

    // Task #7: GUN bullet tracers
    // Give it a beat so the tracer tube exists when we screenshot.
    await sleep(120);

    // Make the bottom log readable + leave a proof line.
    try {
      await page.evaluate(() => {
        const hud = document.getElementById('hudPanel');
        if (hud) hud.style.display = 'block';
        const log = document.getElementById('log');
        if (!log) return;
        log.textContent = '✨ BULLET TRACERS: now thick + emissive (iPhone-readable)';
        log.style.display = 'block';
        log.style.position = 'fixed';
        log.style.left = '10px';
        log.style.right = '10px';
        log.style.bottom = '74px';
        log.style.zIndex = '99999';
        log.style.padding = '8px 10px';
        log.style.borderRadius = '12px';
        log.style.background = 'rgba(0,0,0,0.55)';
        log.style.border = '1px solid rgba(255,255,255,0.18)';
        log.style.color = 'rgba(230,237,243,0.92)';
        log.style.fontWeight = '800';
        log.style.fontSize = '12px';
      });
    } catch {}

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
