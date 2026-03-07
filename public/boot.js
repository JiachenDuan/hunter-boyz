(async () => {
  const ui = document.getElementById('ui');

  // UX: show a lightweight loading overlay while the UI + modules are fetched.
  // On slow iPhone networks the screen can otherwise look "stuck" for a few seconds.
  if (document.body && !document.getElementById('uiLoading')) {
    const loading = document.createElement('div');
    loading.id = 'uiLoading';
    loading.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9999;';
    loading.innerHTML = `
      <div style="padding:10px 12px;border-radius:12px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.16);color:#fff;font-weight:800;letter-spacing:.3px;backdrop-filter: blur(6px);">
        Loading…
      </div>
    `;
    document.body.appendChild(loading);
  }

  const uiParts = [
    'components/hud.html',
    'components/lobby-respawn.html',
    'components/status-overlays.html',
    'components/controls.html',
    'components/modals.html',
  ];
  const scriptParts = [
    'app/modules/core-state-network.js',
    'app/modules/scene-rig.js',
    'app/modules/combat-audio-ui.js',
    'app/modules/projectiles-effects.js',
    'app/modules/controls-loop.js',
  ];

  try {
    const htmlParts = await Promise.all(
      uiParts.map(async (path) => {
        const res = await fetch(path, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
        return res.text();
      })
    );

    ui.innerHTML = htmlParts.join('\n\n');

    const loadingEl = document.getElementById('uiLoading');
    if (loadingEl) loadingEl.remove();

    const jsParts = await Promise.all(
      scriptParts.map(async (path) => {
        const res = await fetch(path, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
        return `/* ${path} */\n${await res.text()}`;
      })
    );

    const appScript = document.createElement('script');
    appScript.textContent = jsParts.join('\n\n');
    document.body.appendChild(appScript);
  } catch (err) {
    console.error(err);

    const loadingEl = document.getElementById('uiLoading');
    if (loadingEl) loadingEl.remove();

    if (ui) {
      // Avoid innerHTML here: show a clear error banner with a one-tap Retry.
      ui.innerHTML = '';

      const banner = document.createElement('div');
      banner.style.cssText = [
        'position:fixed',
        'top:10px',
        'left:10px',
        'right:10px',
        'max-width:520px',
        'padding:10px 12px',
        'border-radius:12px',
        'background:rgba(0,0,0,.62)',
        'border:1px solid rgba(255,255,255,.2)',
        'font-weight:800',
        'pointer-events:auto',
        'z-index:9999',
      ].join(';') + ';';

      const title = document.createElement('div');
      title.textContent = 'UI failed to load.';
      title.style.cssText = 'margin-bottom:6px;';

      const detail = document.createElement('div');
      detail.textContent = String(err && err.message ? err.message : err);
      detail.style.cssText = 'opacity:.9;font-weight:700;font-size:12px;line-height:1.25;margin-bottom:10px;';

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;';

      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.title = 'Reload the page';
      retry.style.cssText = [
        'appearance:none',
        'border:none',
        'border-radius:10px',
        'padding:8px 10px',
        'background:rgba(255,255,255,.16)',
        'color:#fff',
        'font-weight:900',
        'letter-spacing:.2px',
      ].join(';') + ';';
      retry.addEventListener('click', () => location.reload());

      const hint = document.createElement('div');
      hint.textContent = 'If you’re offline, reconnect and tap Retry.';
      hint.style.cssText = 'opacity:.85;font-weight:700;font-size:12px;';

      row.appendChild(retry);
      row.appendChild(hint);

      banner.appendChild(title);
      banner.appendChild(detail);
      banner.appendChild(row);
      ui.appendChild(banner);
    }
  }
})();
