const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const outDir = path.join(__dirname, '..', 'snaps');
  fs.mkdirSync(outDir, { recursive: true });

  const url = process.env.GAME_URL || 'http://127.0.0.1:3030';

  // Use system Chrome on macOS.
  const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!fs.existsSync(chromePath)) {
    throw new Error(`Chrome not found at ${chromePath}. Set CHROME_PATH.`);
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1280,720',
    ],
    defaultViewport: { width: 1280, height: 720 },
  });

  try {
    const p1 = await browser.newPage();
    const p2 = await browser.newPage();

    await Promise.all([p1.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }), p2.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })]);

    // Join both players
    await p1.evaluate(() => { document.getElementById('name').value = 'Boy1'; document.getElementById('autofire').checked = false; });
    await p2.evaluate(() => { document.getElementById('name').value = 'Boy2'; document.getElementById('autofire').checked = false; });

    await Promise.all([
      p1.evaluate(() => document.getElementById('joinBtn').dispatchEvent(new Event('click', { bubbles: true }))),
      p2.evaluate(() => document.getElementById('joinBtn').dispatchEvent(new Event('click', { bubbles: true }))),
    ]);

    // Wait for websocket welcome
    await sleep(800);

    // Determine ids from scoreboard DOM (fallback: assume 1 and 2)
    const ids = { p1: '1', p2: '2' };

    // Force start + place them facing each other, close enough for clear screenshots.
    await fetch(url + '/debug/start', { method: 'POST' });
    await fetch(url + '/debug/teleport', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ids.p1, x: 0, y: 1.8, z: -6, yaw: 0, pitch: 0, hp: 100 }) });
    await fetch(url + '/debug/teleport', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ids.p2, x: 0, y: 1.8, z: -1.8, yaw: Math.PI, pitch: 0, hp: 100 }) });

    // Shoot a couple times to drop HP.
    await fetch(url + '/debug/shoot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fromId: ids.p1 }) });
    await sleep(120);
    await fetch(url + '/debug/shoot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fromId: ids.p1 }) });

    // Wait for tracer + UI updates, then screenshot.
    await sleep(200);

    const ts = Date.now();
    const file1 = path.join(outDir, `p1-${ts}.png`);
    const file2 = path.join(outDir, `p2-${ts}.png`);

    await p1.screenshot({ path: file1, fullPage: false });
    await p2.screenshot({ path: file2, fullPage: false });

    console.log(JSON.stringify({ file1, file2 }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
