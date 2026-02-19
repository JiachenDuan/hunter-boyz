(async () => {
  const ui = document.getElementById('ui');
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
    if (ui) {
      ui.innerHTML = '<div style="position:fixed;top:10px;left:10px;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.2);font-weight:700;pointer-events:auto;">UI failed to load. Refresh page.</div>';
    }
  }
})();
