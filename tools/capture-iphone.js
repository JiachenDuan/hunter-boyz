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
    await sleep(800);

    const ts = Date.now();
    const file = path.join(outDir, `iphone-${ts}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(JSON.stringify({ file }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((e)=>{ console.error(e); process.exit(1); });
