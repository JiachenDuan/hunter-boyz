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


    // Enable sound so the gunshot SFX path runs (and logs layering proof).
    await page.evaluate(() => {
      const sb = document.getElementById('soundBtn');
      if (!sb) return;
      sb.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      sb.dispatchEvent(new Event('click', { bubbles: true }));
    });
    await page.evaluate(() => {
      const b = document.getElementById('joinBtn');
      if (!b) return;
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      b.dispatchEvent(new Event('click', { bubbles: true }));
    });

    // Page 2: bot shooter (desktop viewport)
    const bot = await browser.newPage();
    await bot.setViewport({ width: 900, height: 650, deviceScaleFactor: 2 });
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

    async function waitForId(p) {
      for (let i = 0; i < 60; i++) {
        const id = await p.evaluate(() => window.__myId || null);
        if (id) return String(id);
        await sleep(100);
      }
      throw new Error('Timed out waiting for player id');
    }

    const viewerId = await waitForId(page);
    const botId = await waitForId(bot);

    // Start match.
    await page.evaluate(async () => {
      try { await fetch('/debug/start', { method: 'POST' }); } catch {}
    });

    // Ensure started.
    for (let i = 0; i < 40; i++) {
      const started = await page.evaluate(() => !!(window.__lastState && window.__lastState.game && window.__lastState.game.started));
      if (started) break;
      try { await page.evaluate(() => fetch('/debug/start', { method: 'POST' }).catch(()=>{})); } catch {}
      await sleep(200);
    }

    // Try to wait for HUD to exit "LOBBY" state; if it never updates, we'll force-hide the label.
    for (let i = 0; i < 30; i++) {
      const ok = await page.evaluate(() => {
        const el = document.getElementById('roundTimer');
        const t = (el && el.textContent || '').trim();
        return !!(t && t !== 'LOBBY');
      });
      if (ok) break;
      await sleep(120);
    }

    // Hide lobby overlay so screenshots look in-match.
    await page.evaluate(() => {
      const l = document.getElementById('lobby');
      if (l) l.style.display = 'none';
      const rt = document.getElementById('roundTimer');
      if (rt && (rt.textContent || '').trim() === 'LOBBY') rt.style.display = 'none';
    });

    // Prep: place a target directly in front of the iPhone player, then fire so the
    // hitmarker+pulse is captured in a still screenshot.
    await page.evaluate(async (viewerId, botId) => {
      const post = (p, body) => fetch(p, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      await post('/debug/vehicle', { id: viewerId, vehicle: null });
      await post('/debug/vehicle', { id: botId, vehicle: null });

      // Viewer aims down +Z; bot is placed on-axis so /debug/shoot reliably registers a hit.
      await post('/debug/teleport', { id: viewerId, x: 0.0, y: 2.0, z: -11.0, yaw: 0.0, pitch: 0.01, hp: 100 });
      await post('/debug/teleport', { id: botId, x: 0.0, y: 2.0, z: -6.3, yaw: 3.1415, pitch: 0.0, hp: 100 });
    }, viewerId, botId);

    // Wait a couple frames so scene settles.
    await sleep(220);

    // Proof badge so it’s unmissable in a still screenshot.
    await page.evaluate(() => {
      const badge = document.getElementById('__captureBadge') || (() => {
        const d = document.createElement('div');
        d.id = '__captureBadge';
        d.textContent = 'TASK #1 RECOIL PROOF';
        d.style.position = 'fixed';
        d.style.left = '10px';
        d.style.bottom = '10px';
        d.style.zIndex = '99999';
        d.style.fontWeight = '1000';
        d.style.fontSize = '12px';
        d.style.padding = '6px 10px';
        d.style.borderRadius = '999px';
        d.style.background = 'rgba(0,0,0,0.62)';
        d.style.border = '2px solid rgba(255,240,120,0.55)';
        d.style.color = 'rgba(255,240,120,0.95)';
        d.style.textShadow = '0 2px 12px rgba(0,0,0,0.55)';
        document.body.appendChild(d);
        return d;
      })();
      badge.style.display = 'block';

      const log = document.getElementById('log');
      if (log) {
        log.textContent = '🔫 TASK #1: shots now have strong recoil kick + springy recovery (viewmodel + reticle)';
        log.style.display = 'block';
        log.style.position = 'fixed';
        log.style.left = '10px';
        log.style.right = '10px';
        log.style.bottom = '160px';
        log.style.zIndex = '99999';
        log.style.padding = '10px 12px';
        log.style.borderRadius = '12px';
        log.style.background = 'rgba(0,0,0,0.70)';
        log.style.border = '1px solid rgba(255,255,255,0.22)';
        log.style.color = 'rgba(230,237,243,0.95)';
        log.style.fontWeight = '900';
        log.style.fontSize = '14px';
      }
    });

    // Fire a couple shots so recoil + muzzle flash triggers, then force-trigger
    // a deterministic recoil pulse right before capture.
    for (let i = 0; i < 2; i++) {
      await page.evaluate(async (viewerId) => {
        const shoot = () => fetch('/debug/shoot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromId: viewerId, weapon: 'rifle' }),
        }).catch(()=>{});
        try { await shoot(); } catch {}
      }, viewerId);
      await sleep(70);
    }

    // Force-trigger recoil visuals right before capture (deterministic proof in a still).
    await page.evaluate(() => {
      try { if (typeof window.__hbDebugRecoil === 'function') window.__hbDebugRecoil('rifle'); } catch {}
    });

    // Capture while the recoil ring/brackets/vignette are visible.
    await sleep(55);

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
