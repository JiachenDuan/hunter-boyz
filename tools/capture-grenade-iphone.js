const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function main(){
  const outDir = path.join(__dirname, '..', 'snaps');
  fs.mkdirSync(outDir, { recursive: true });

  const url = process.env.GAME_URL || 'http://127.0.0.1:3030/?v=grenade';
  const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!fs.existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();

    // iPhone-ish viewport
    await page.setViewport({
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/121.0.0.0 Mobile/15E148 Safari/604.1');

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Join
    await page.evaluate(() => {
      document.getElementById('settingsPanel').style.display = 'block';
      document.getElementById('name').value = 'GrenadeTest';
    });
    await page.evaluate(() => document.getElementById('joinBtn').dispatchEvent(new Event('click', { bubbles: true })));
    await sleep(700);

    // Start match (anyone can tap Start)
    await page.evaluate(() => {
      const b = document.getElementById('startBtn');
      if (b) b.dispatchEvent(new Event('click', { bubbles: true }));
    });
    await sleep(350);

    // Select grenade
    const kind = process.env.GRENADE_KIND || 'grenade_frag';
    await page.evaluate((kind) => {
      const sel = document.getElementById('weapon');
      if (sel) { sel.value = kind; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      // close settings for gameplay
      try { document.getElementById('settingsPanel').style.display = 'none'; } catch {}
    }, kind);

    await sleep(250);

    // Throw once: tap shoot quickly
    await page.evaluate(() => {
      const el = document.getElementById('btnShoot');
      if (!el) return;
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch' }));
    });
    await sleep(120);
    await page.evaluate(() => {
      const el = document.getElementById('btnShoot');
      if (!el) return;
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch' }));
    });

    const ts = Date.now();
    const file1 = path.join(outDir, `iphone-grenade-throw-${ts}.png`);
    await sleep(30);
    await page.screenshot({ path: file1, fullPage: false });

    // Wait for fuse/explosion
    const waitMs = Number(process.env.WAIT_MS || 1400);
    await sleep(waitMs);

    const file2 = path.join(outDir, `iphone-grenade-explosion-${ts}.png`);
    await page.screenshot({ path: file2, fullPage: false });

    console.log(JSON.stringify({ fileThrow: file1, fileExplosion: file2, kind }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((e)=>{ console.error(e); process.exit(1); });
