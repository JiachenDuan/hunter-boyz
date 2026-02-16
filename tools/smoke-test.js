const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function main() {
  const url = process.env.GAME_URL || 'http://127.0.0.1:3030/?v=smoke';
  const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

  if (!fs.existsSync(chromePath)) throw new Error('Chrome not found: ' + chromePath);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

  const errors = [];
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
    if (el) el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });

  await sleep(100);

  // Ensure no hard errors
  await browser.close();

  const ok = errors.length === 0;
  console.log(JSON.stringify({ ok, errors }, null, 2));
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
