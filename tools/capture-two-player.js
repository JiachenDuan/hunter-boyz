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

    // Join both players, then start as host (player 1)
    await p1.evaluate(() => { document.getElementById('name').value = 'Boy1'; });
    await p2.evaluate(() => { document.getElementById('name').value = 'Boy2'; });

    await Promise.all([
      p1.evaluate(() => document.getElementById('joinBtn').dispatchEvent(new Event('click', { bubbles: true }))),
      p2.evaluate(() => document.getElementById('joinBtn').dispatchEvent(new Event('click', { bubbles: true }))),
    ]);

    // Wait for lobby to show and then start
    await sleep(800);
    await p1.evaluate(() => {
      const btn = document.getElementById('startBtn');
      if (btn && btn.offsetParent) btn.dispatchEvent(new Event('click', { bubbles: true }));
    });

    // Move player 1 forward, aim at player 2, shoot a few times.
    // We drive the client-side state directly to avoid complex pointer simulation.
    await sleep(800);

    await p1.evaluate(() => {
      // Expose state via global lookup (best-effort)
      // We can't directly access closure vars, so we approximate: toggle autofire and hold shoot via button.
      const auto = document.getElementById('autofire');
      if (auto) auto.checked = false;
      // Drag-to-look fallback: just set a bunch of pointer moves on canvas
      const canvas = document.getElementById('renderCanvas');
      const rect = canvas.getBoundingClientRect();
      const startX = rect.left + rect.width * 0.75;
      const startY = rect.top + rect.height * 0.5;
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: startX, clientY: startY, pointerId: 1, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: startX + 120, clientY: startY, pointerId: 1, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: startX + 120, clientY: startY, pointerId: 1, bubbles: true }));
    });

    // Press and hold move stick "forward" by firing pointer events on moveStick
    await p1.evaluate(() => {
      const stick = document.getElementById('moveStick');
      const r = stick.getBoundingClientRect();
      const cx = r.left + r.width/2;
      const cy = r.top + r.height/2;
      stick.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy - 40, pointerId: 2, bubbles: true }));
      stick.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy - 55, pointerId: 2, bubbles: true }));
    });

    await sleep(700);

    // Shoot bursts and screenshot while tracer is visible
    await p1.evaluate(() => {
      const shoot = document.getElementById('btnShoot');
      shoot.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerId: 3, bubbles: true }));
    });

    // Give it a moment so the tracer/hit feedback appears
    await sleep(180);

    const ts = Date.now();
    const file1 = path.join(outDir, `p1-${ts}.png`);
    const file2 = path.join(outDir, `p2-${ts}.png`);

    await p1.screenshot({ path: file1, fullPage: false });
    await p2.screenshot({ path: file2, fullPage: false });

    await sleep(250);

    await p1.evaluate(() => {
      const shoot = document.getElementById('btnShoot');
      shoot.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10, pointerId: 3, bubbles: true }));
    });

    // Stop moving
    await p1.evaluate(() => {
      const stick = document.getElementById('moveStick');
      stick.dispatchEvent(new PointerEvent('pointerup', { clientX: 0, clientY: 0, pointerId: 2, bubbles: true }));
    });

    console.log(JSON.stringify({ file1, file2 }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
