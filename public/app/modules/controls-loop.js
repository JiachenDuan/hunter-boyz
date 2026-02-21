    // Touch controls
    function makeStick(el, nubEl, onMove) {
      let active = false;

      const rect = () => el.getBoundingClientRect();
      const clamp = (v,a,b) => Math.max(a, Math.min(b, v));

      const setNub = (dx, dy) => {
        if (!nubEl) return;
        const max = 44;
        nubEl.style.transform = `translate(${clamp(dx,-max,max)}px, ${clamp(dy,-max,max)}px)`;
      };

      const prevent = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };

      el.addEventListener('contextmenu', (e) => prevent(e));

      el.addEventListener('pointerdown', (e) => {
        prevent(e);
        active = true;
        el.setPointerCapture(e.pointerId);
        setNub(0,0);
        onMove(0,0,true);
      }, { passive: false });

      el.addEventListener('pointermove', (e) => {
        if (!active) return;
        prevent(e);
        const r = rect();
        const dx = e.clientX - (r.left + r.width/2);
        const dy = e.clientY - (r.top + r.height/2);
        const max = 55;
        const nx = clamp(dx / max, -1, 1);
        const ny = clamp(dy / max, -1, 1);
        setNub(dx,dy);
        onMove(nx, ny, false);
      }, { passive: false });

      const end = (e) => {
        if (!active) return;
        prevent(e);
        active = false;
        setNub(0,0);
        onMove(0,0,true);
      };
      el.addEventListener('pointerup', end, { passive: false });
      el.addEventListener('pointercancel', end, { passive: false });
      el.addEventListener('pointerleave', end, { passive: false });
    }

    makeStick(
      document.getElementById('moveStick'),
      document.getElementById('moveNub'),
      (nx, ny) => {
        // stick up = forward; add small deadzone so it's easier to control
        const dz = parseFloat(document.getElementById('deadzone')?.value || "0.14");
        const mag = Math.hypot(nx, ny);
        if (mag < dz) {
          const autoRun = !!document.getElementById('autoRun')?.checked;
          state.move.x = 0;
          state.move.z = autoRun ? 1 : 0;
          return;
        }
        const scale = (mag - dz) / (1 - dz);
        const ux = nx / mag;
        const uy = ny / mag;
        state.move.x = ux * scale;
        state.move.z = -uy * scale;
      }
    );

    // look pad: drag deltas
    // Look controls:
    // - Primary: right look pad
    // - Fallback: drag anywhere on the right half of the screen
    (() => {
      const pad = document.getElementById('lookPad');
      let active = false;
      let last = null;
      let sensTurn = parseFloat(document.getElementById('sensTurn')?.value || '2.2');
      let sensAim = parseFloat(document.getElementById('sensAim')?.value || '2.2');

      document.getElementById('sensTurn')?.addEventListener('input', (e) => {
        sensTurn = parseFloat(e.target.value || '2.2');
        try { localStorage.setItem('hunterBoyz.sensTurn', String(sensTurn)); } catch {}
      });
      document.getElementById('sensAim')?.addEventListener('input', (e) => {
        sensAim = parseFloat(e.target.value || '2.2');
        try { localStorage.setItem('hunterBoyz.sensAim', String(sensAim)); } catch {}
      });

      const prevent = (e) => {
        if (!e) return;
        e.preventDefault();
        e.stopPropagation();
      };

      function applyDelta(dx, dy) {
        // Slow down turning a bit (was too twitchy on iPhone).
        state.look.yaw += dx * 0.0024 * sensTurn;
        // Up/down look ~25% slower
        state.look.pitch += dy * 0.00165 * sensAim;
        // Limit looking up/down so you don't get lost on mobile.
        // (radians) ~ -35° down to +20° up
        const MIN_PITCH = -0.55;
        const MAX_PITCH = 0.20; // allow slight looking up
        state.look.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, state.look.pitch));
      }

      function startAt(x, y) {
        active = true;
        last = { x, y };
      }

      function moveTo(x, y) {
        if (!active || !last) return;
        const dx = x - last.x;
        const dy = y - last.y;
        last = { x, y };
        applyDelta(dx, dy);
      }

      function end() {
        active = false;
        last = null;
      }

      // Disable long-press menu
      pad.addEventListener('contextmenu', (e) => prevent(e));
      canvas.addEventListener('contextmenu', (e) => prevent(e));

      // Pointer events on pad
      pad.addEventListener('pointerdown', (e) => {
        prevent(e);
        pad.setPointerCapture(e.pointerId);
        startAt(e.clientX, e.clientY);
      }, { passive: false });

      pad.addEventListener('pointermove', (e) => {
        if (!active) return;
        prevent(e);
        moveTo(e.clientX, e.clientY);
      }, { passive: false });

      pad.addEventListener('pointerup', (e) => { prevent(e); end(); }, { passive: false });
      pad.addEventListener('pointercancel', (e) => { prevent(e); end(); }, { passive: false });
      pad.addEventListener('pointerleave', (e) => { prevent(e); end(); }, { passive: false });

      // Fallback: drag on canvas right half (ONLY while game is started)
      canvas.addEventListener('pointerdown', (e) => {
        if (!state.joined || !state.started || state.settingsOpen) return;
        if (e.clientX < window.innerWidth * 0.5) return;
        prevent(e);
        canvas.setPointerCapture(e.pointerId);
        startAt(e.clientX, e.clientY);
      }, { passive: false });

      canvas.addEventListener('pointermove', (e) => {
        if (!active) return;
        prevent(e);
        moveTo(e.clientX, e.clientY);
      }, { passive: false });

      canvas.addEventListener('pointerup', (e) => { if (active) prevent(e); end(); }, { passive: false });
      canvas.addEventListener('pointercancel', (e) => { if (active) prevent(e); end(); }, { passive: false });

      // iOS Safari sometimes prefers touch events; add a lightweight touch fallback.
      canvas.addEventListener('touchstart', (e) => {
        if (!state.joined || !state.started || state.settingsOpen) return;
        const t = e.touches && e.touches[0];
        if (!t) return;
        if (t.clientX < window.innerWidth * 0.5) return;
        prevent(e);
        startAt(t.clientX, t.clientY);
      }, { passive: false });

      canvas.addEventListener('touchmove', (e) => {
        if (!active) return;
        const t = e.touches && e.touches[0];
        if (!t) return;
        prevent(e);
        moveTo(t.clientX, t.clientY);
      }, { passive: false });

      canvas.addEventListener('touchend', (e) => { if (active) prevent(e); end(); }, { passive: false });
      canvas.addEventListener('touchcancel', (e) => { if (active) prevent(e); end(); }, { passive: false });
    })();

    // Buttons
    function holdButton(el, on) {
      const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
      const press = (v) => {
        try { el.classList.toggle('btnPressed', !!v); } catch {}
        on(!!v);
      };
      el.addEventListener('contextmenu', (e) => prevent(e));
      el.addEventListener('pointerdown', (e)=>{ prevent(e); el.setPointerCapture(e.pointerId); press(true); }, { passive:false });
      el.addEventListener('pointerup', (e)=>{ prevent(e); press(false); }, { passive:false });
      el.addEventListener('pointercancel', (e)=>{ prevent(e); press(false); }, { passive:false });
      el.addEventListener('pointerleave', (e)=>{ prevent(e); press(false); }, { passive:false });
    }
    // Shoot: hold-to-fire by default; optional tap-to-toggle (autofire)
    const autoFireEl = document.getElementById('autofire');
    const shootEl = document.getElementById('btnShoot');
    let shootToggled = false;
    holdButton(shootEl, (v)=> {
      if (autoFireEl.checked) {
        // Tap-to-toggle when autofire is enabled.
        if (v) { shootToggled = !shootToggled; state.shoot = shootToggled; }
      } else {
        // Hold-to-fire when autofire is disabled.
        state.shoot = v;
        if (!v) shootToggled = false;
      }
    });

    // If user turns OFF autofire while shooting is toggled ON, stop immediately.
    autoFireEl.addEventListener('change', () => {
      if (!autoFireEl.checked) {
        shootToggled = false;
        state.shoot = false;
      }
    });


    // Pickup: tap to request pickup from nearest pad/drop
    (() => {
      const el = document.getElementById('btnPickup');
      const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
      if (!el) return;
      let lastPickupSend = 0;
      const act = (e) => {
        prevent(e);
        // Debounce: ignore duplicate events within 350ms
        const now = Date.now();
        if (now - lastPickupSend < 350) return;

        // Get pickId from element, or fallback: scan lastServerState for nearest available pickup
        let pickId = el.dataset.pickId || '';
        let dist = null;
        if (lastServerState && myId) {
          const me = lastServerState.players.find(p => p.id === myId);
          const list = (lastServerState.pickups || []);
          if (me) {
            const findIt = (id) => list.find(it => String(it.id) === String(id));
            const it0 = pickId ? findIt(pickId) : null;
            if (it0) {
              dist = Math.hypot(me.x - it0.x, me.z - it0.z);
            }
            if (!pickId) {
              for (const it of list) {
                if (it.type !== 'minigun') continue;
                if (it.kind === 'pad' && (it.availInMs||0) > 0) continue;
                if (it.kind === 'drop' && (it.expiresInMs||0) <= 0) continue;
                const d = Math.hypot(me.x - it.x, me.z - it.z);
                if (d <= 3.0) { pickId = it.id; dist = d; break; }
              }
            }
          }
        }
        if (!pickId) { showKill('Move closer to pick up!'); return; }
        // Server requires close range (pad ~2.5, drop ~2.2). Give a tiny buffer.
        if (typeof dist === 'number' && dist > 2.7) { showKill('Move closer to pick up!'); return; }

        // Visual tap feedback
        el.style.background = 'rgba(255,220,120,0.5)';
        setTimeout(() => { el.style.background = 'rgba(255,220,120,0.16)'; }, 150);

        if (!socket || socket.readyState !== 1) {
          showKill('Server disconnected!');
          return;
        }
        lastPickupSend = now;
        try { socket.send(JSON.stringify({ t:'pickup', id: pickId })); } catch {}
      };
      // Use only pointerdown (covers both mouse and touch on iOS Safari; avoid double-firing with touchstart)
      el.addEventListener('pointerdown', act, { passive:false });
    })();

    // Tower teleport buttons
    (() => {
      function bind(id, msgId) {
        const el = document.getElementById(id);
        if (!el) return;
        const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
        let last = 0;
        const act = (e) => {
          prevent(e);
          const now = Date.now();
          if (now - last < 350) return;
          if (!socket || socket.readyState !== 1) { showKill('Server disconnected!'); return; }
          last = now;
          try { socket.send(JSON.stringify({ t:'teleport', id: msgId })); } catch {}
        };
        el.addEventListener('pointerdown', act, { passive:false });
      }
      bind('btnTowerUp', 'tower_up');
      bind('btnTowerDown', 'tower_down');
    })();

    // DROP MINIGUN button
    (() => {
      const el = document.getElementById('btnDropMinigun');
      if (!el) return;
      const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
      let lastDrop = 0;
      const act = (e) => {
        prevent(e);
        const now = Date.now();
        if (now - lastDrop < 500) return; // debounce
        el.style.background = 'rgba(255,60,60,0.4)';
        setTimeout(() => { el.style.background = 'rgba(255,60,60,0.18)'; }, 150);
        if (!socket || socket.readyState !== 1) { showKill('Server disconnected!'); return; }
        lastDrop = now;
        try { socket.send(JSON.stringify({ t:'dropMinigun' })); } catch {}
      };
      el.addEventListener('pointerdown', act, { passive:false });
    })();

    holdButton(document.getElementById('btnJump'), (v)=> state.jump = v);
    // sprint removed

    // Reload: tap
    (() => {
      const el = document.getElementById('btnReload');
      const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
      const fire = (e) => {
        prevent(e);
        try { el.classList.add('btnPressed'); setTimeout(() => el.classList.remove('btnPressed'), 90); } catch {}
        if (!socket || socket.readyState !== 1) return;
        socket.send(JSON.stringify({ t:'reload' }));
      };
      el.addEventListener('click', fire);
      el.addEventListener('pointerdown', fire, { passive:false });
      el.addEventListener('touchend', fire, { passive:false });
    })();

    // Scope: toggle (only affects sniper)
    (() => {
      const el = document.getElementById('btnScope');
      const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
      const fire = (e) => {
        prevent(e);
        // Only toggle scope when sniper is selected
        const w = document.getElementById('weapon')?.value;
        if (w !== 'sniper') return;
        state.scope = !state.scope;
        updateScopeUI();
        try { el.classList.toggle('btnPressed', state.scope); } catch {}
        try { log(`Scope: ${state.scope ? 'ON' : 'OFF'}`); } catch {}
      };
      // iOS fires multiple events (touchend + click). Debounce so scope doesn't instantly flip back.
      let lastScopeAt = 0;
      const fireOnce = (e) => {
        const now = Date.now();
        if (now - lastScopeAt < 450) return;
        lastScopeAt = now;
        fire(e);
      };

      // Prefer pointerup/touchend; skip click to avoid double-trigger.
      el.addEventListener('pointerup', fireOnce, { passive:false });
      el.addEventListener('touchend', fireOnce, { passive:false });
    })();

    // Join
    const joinBtn = document.getElementById('joinBtn');
    const nameInput = document.getElementById('name');
    const autoReloadEl = document.getElementById('autoReload');
    const reloadBtn = document.getElementById('btnReload');
    const weaponEl = document.getElementById('weapon');
    const mapEls = [document.getElementById('map'), document.getElementById('mapLobby')].filter(Boolean);

    // --- Weapon picker modal ---
    const weaponModal = document.getElementById('weaponModal');
    const weaponModalClose = document.getElementById('weaponModalClose');
    const btnWeaponPick = document.getElementById('btnWeaponPick');
    const wmOpts = document.querySelectorAll('#weaponModalInner .wm-opt');

    function syncPickerHighlight() {
      const cur = weaponEl?.value || 'rifle';
      wmOpts.forEach(o => o.classList.toggle('selected', o.dataset.weapon === cur));
    }

    function openWeaponModal() {
      syncPickerHighlight();
      weaponModal.classList.add('open');
    }
    function closeWeaponModal() {
      weaponModal.classList.remove('open');
    }

    btnWeaponPick?.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      openWeaponModal();
    });

    weaponModalClose?.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      closeWeaponModal();
    });

    // Tap backdrop to close
    weaponModal?.addEventListener('pointerdown', (e) => {
      if (e.target === weaponModal) { e.preventDefault(); closeWeaponModal(); }
    });

    wmOpts.forEach(opt => {
      opt.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const val = opt.dataset.weapon;
        if (weaponEl) {
          weaponEl.value = val;
          weaponEl.dispatchEvent(new Event('change'));
        }
        try { localStorage.setItem('hunterBoyz.weapon', val); } catch {}
        closeWeaponModal();
      });
    });

    // Restore persisted weapon on load
    try {
      const saved = localStorage.getItem('hunterBoyz.weapon');
      if (saved && weaponEl) {
        weaponEl.value = saved;
        weaponEl.dispatchEvent(new Event('change'));
      }
    } catch {}


    // Persist username + settings locally so re-joining is fast.
    const NAME_KEY = 'hunterBoyz.name';
    const AUTO_RELOAD_KEY = 'hunterBoyz.autoReload';
    const MAP_KEY = 'hunterBoyz.mapId';
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (saved && !nameInput.value) nameInput.value = saved;

      const savedAR = localStorage.getItem(AUTO_RELOAD_KEY);
      if (savedAR !== null && autoReloadEl) autoReloadEl.checked = (savedAR === '1');
      const savedMap = localStorage.getItem(MAP_KEY);
      if (savedMap) {
        mapEls.forEach((el) => { try { el.value = savedMap; } catch {} });
      }
    } catch {}

    function getSelectedMapId() {
      const lobby = document.getElementById('mapLobby');
      const settings = document.getElementById('map');
      return (lobby?.value || settings?.value || 'arena');
    }
    function syncMapSelects(mapId) {
      mapEls.forEach((el) => { try { el.value = mapId; } catch {} });
    }

    function sendMapSelection() {
      const mapId = getSelectedMapId();
      syncMapSelects(mapId);
      try { localStorage.setItem(MAP_KEY, mapId); } catch {}
      if (!socket || socket.readyState !== 1) { try { log('Map not sent: offline'); } catch {} return; }
      if (!state.joined) { try { log('Map not sent: join first'); } catch {} return; }
      if (state.started) { try { log('Map locked after round start'); } catch {} return; }
      try { socket.send(JSON.stringify({ t:'setMap', mapId })); } catch {}
    }
    mapEls.forEach((el) => el.addEventListener('change', () => {
      const mapId = (el.value || 'arena');
      syncMapSelects(mapId);
      // Instant local feedback; server state remains source of truth.
      try { state.mapId = mapId; } catch {}
      try { window.__hbApplyMapVisual?.(mapId); } catch {}
      try { clearDents(); } catch {}
      sendMapSelection();
      try { log(`Map selected: ${mapId}`); } catch {}
    }));

    function syncReloadButtonVisibility() {
      const on = !!autoReloadEl?.checked;
      try { if (reloadBtn) reloadBtn.style.display = on ? 'none' : 'flex'; } catch {}
    }
    syncReloadButtonVisibility();
    autoReloadEl?.addEventListener('change', () => {
      try { localStorage.setItem(AUTO_RELOAD_KEY, autoReloadEl.checked ? '1' : '0'); } catch {}
      syncReloadButtonVisibility();
    });

    // Swap first-person gun model when weapon changes
    weaponEl?.addEventListener('change', () => {
      try { ensureFirstPersonRig()?.setGun?.(weaponEl.value); } catch {}
      // If switching away from sniper, force scope off.
      if (weaponEl.value !== 'sniper') state.scope = false;
      updateScopeUI();
    });
    const startBtn = document.getElementById('startBtn');
    const snapBtn = document.getElementById('snapBtn');
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    const btnScoreboard = document.getElementById('btnScoreboard');
    const scoreModal = document.getElementById('scoreModal');
    const btnScoreClose = document.getElementById('btnScoreClose');
    const soundBtn = document.getElementById('soundBtn');
    const resetLobbyBtn = document.getElementById('resetLobbyBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsPanel = document.getElementById('settingsPanel');

    let joinInFlight = false;
    let lastJoinAt = 0;
    function doJoin(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const now = Date.now();
      // iOS can fire pointerdown + touchend + click; debounce hard.
      if (now - lastJoinAt < 600) return;
      lastJoinAt = now;

      if (state.joined || joinInFlight) return;
      joinInFlight = true;

      // Disable immediately so duplicate events can't open multiple sockets.
      try { joinBtn.disabled = true; nameInput.disabled = true; } catch {}

      // Save name + settings before joining.
      try {
        const v = (nameInput.value || '').trim();
        if (v) localStorage.setItem(NAME_KEY, v);
        if (autoReloadEl) localStorage.setItem(AUTO_RELOAD_KEY, autoReloadEl.checked ? '1' : '0');
        localStorage.setItem(MAP_KEY, getSelectedMapId());
      } catch {}

      // Hide settings while playing; you can reopen via Settings.
      state.settingsOpen = false;
      settingsPanel.style.display = 'none';
      try { syncHudCompact(); } catch {}

      // Ensure audio is unlocked early on iOS.
      try { SFX.enable(); } catch {}
      connectAndJoin();
    }

    let pendingStart = false;
    function trySendStart() {
      if (!pendingStart) return;
      if (!socket || socket.readyState !== 1) return;
      if (!state.joined) return;
      pendingStart = false;
      try { socket.send(JSON.stringify({ t:'start' })); } catch {}
    }

    function doStart(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      sendMapSelection();
      pendingStart = true;
      trySendStart();
    }

    function doSnap(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (!socket || socket.readyState !== 1) { log('Snapshot failed: offline'); return; }

      // Downscale before encoding (iPhone can choke on huge base64 payloads).
      const snapMaxW = 720;
      const srcW = canvas.width || 1280;
      const srcH = canvas.height || 720;
      const scale = Math.min(1, snapMaxW / srcW);
      const outW = Math.max(1, Math.round(srcW * scale));
      const outH = Math.max(1, Math.round(srcH * scale));

      let dataUrl = null;
      try {
        const tmp = document.createElement('canvas');
        tmp.width = outW;
        tmp.height = outH;
        const ctx = tmp.getContext('2d');
        ctx.drawImage(canvas, 0, 0, outW, outH);
        dataUrl = tmp.toDataURL('image/jpeg', 0.55);
      } catch (err) {
        try { dataUrl = canvas.toDataURL('image/jpeg', 0.5); } catch {}
      }

      if (!dataUrl) { log('Snapshot failed: canvas capture blocked'); return; }
      try {
        socket.send(JSON.stringify({ t:'snap', dataUrl }));
        log('Snapshot sent (saving on server)…');
      } catch {
        log('Snapshot failed: send error');
      }
    }

    async function doCopyLink(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const link = location.href;
      try {
        await navigator.clipboard.writeText(link);
        log('Link copied. Paste into the other phone.');
      } catch {
        log('Copy failed. Link: ' + link);
      }
    }

    // iOS Safari can be flaky with click depending on viewport/overlays; wire multiple events.
    joinBtn.addEventListener('click', doJoin);
    joinBtn.addEventListener('pointerdown', doJoin, { passive: false });
    joinBtn.addEventListener('touchend', doJoin, { passive: false });

    startBtn.addEventListener('click', doStart);
    startBtn.addEventListener('pointerdown', doStart, { passive: false });
    startBtn.addEventListener('touchend', doStart, { passive: false });

    snapBtn.addEventListener('click', doSnap);
    snapBtn.addEventListener('pointerdown', doSnap, { passive: false });
    snapBtn.addEventListener('touchend', doSnap, { passive: false });

    copyLinkBtn.addEventListener('click', doCopyLink);
    copyLinkBtn.addEventListener('pointerdown', doCopyLink, { passive: false });
    copyLinkBtn.addEventListener('touchend', doCopyLink, { passive: false });

    function doScoreboard(e){ if (e) { e.preventDefault(); e.stopPropagation(); } try { scoreModal.style.display = 'flex'; } catch {} }
    function doScoreClose(e){ if (e) { e.preventDefault(); e.stopPropagation(); } try { scoreModal.style.display = 'none'; } catch {} }
    if (btnScoreboard) {
      btnScoreboard.addEventListener('click', doScoreboard);
      btnScoreboard.addEventListener('pointerdown', doScoreboard, { passive:false });
      btnScoreboard.addEventListener('touchend', doScoreboard, { passive:false });
    }
    if (btnScoreClose) {
      btnScoreClose.addEventListener('click', doScoreClose);
      btnScoreClose.addEventListener('pointerdown', doScoreClose, { passive:false });
      btnScoreClose.addEventListener('touchend', doScoreClose, { passive:false });
    }
    if (scoreModal) scoreModal.addEventListener('click', (e)=>{ if (e.target===scoreModal) doScoreClose(e); });

    function doEnableSound(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      try { SFX.enable(); } catch {}
      try { SFX.hit(); } catch {}
      log('Sound enabled.');
    }
    soundBtn.addEventListener('click', doEnableSound);
    soundBtn.addEventListener('pointerdown', doEnableSound, { passive: false });
    soundBtn.addEventListener('touchend', doEnableSound, { passive: false });

    function doResetLobby(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      if (!socket || socket.readyState !== 1) return;
      socket.send(JSON.stringify({ t:'resetLobby' }));
      log('Lobby reset (kicking ghosts)…');
    }
    resetLobbyBtn.addEventListener('click', doResetLobby);
    resetLobbyBtn.addEventListener('pointerdown', doResetLobby, { passive: false });
    resetLobbyBtn.addEventListener('touchend', doResetLobby, { passive: false });

    const hudEl = document.getElementById('hud');
    function syncHudCompact() {
      // Compact whenever settings are closed.
      try { hudEl.classList.toggle('hudCompact', !state.settingsOpen); } catch {}
    }
    syncHudCompact();

    let lastSettingsToggleAt = 0;
    function toggleSettings(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const now = Date.now();
      // Prevent double-toggle from iOS firing multiple events (touchend + click)
      if (now - lastSettingsToggleAt < 350) return;
      lastSettingsToggleAt = now;
      state.settingsOpen = !state.settingsOpen;
      settingsPanel.style.display = state.settingsOpen ? 'block' : 'none';
      syncHudCompact();
    }
    settingsBtn.addEventListener('click', toggleSettings);
    settingsBtn.addEventListener('pointerdown', toggleSettings, { passive:false });
    settingsBtn.addEventListener('touchend', toggleSettings, { passive:false });

    // Keep last server state for aim assist
    var lastServerState = null;

    // Network tick
    let seq = 0;
    let lastSend = performance.now();
    engine.runRenderLoop(() => {
      // ── Recoil decay: smoothly return gun position + camera shake ──
      if (fpRig?.gunRoot) {
        const gz = fpRig.gunRoot.position.z;
        if (gz < -0.001) fpRig.gunRoot.position.z += (-gz) * 0.18;
        else fpRig.gunRoot.position.z = 0;
      }
      // Minigun barrel spin (cosmetic)
      try {
        const eff = (lastServerState && myId) ? (lastServerState.players.find(p=>p.id===myId)?.powerWeapon) : null;
        if (eff === 'minigun' && fpRig?.guns?.minigun?.metadata?._minigunBarrels) {
          const sp = (lastServerState.players.find(p=>p.id===myId)?.mgSpin || 0);
          const rot = 0.35 + sp * 1.25;
          for (const b of fpRig.guns.minigun.metadata._minigunBarrels) {
            b.rotation.z += rot;
          }
        }
      } catch {}      // Knife stab (cosmetic)
      try {
        const k = fpRig?.guns?.knife;
        if (k && k.isEnabled && k.metadata) {
          // decay
          k.metadata._stab = (k.metadata._stab || 0) * 0.78;
          const a = k.metadata._stab || 0;

          // base pose (matches makeGunVariant knife)
          const baseRotX = -0.18;
          const baseRotZ = 0.15;
          const baseY = -0.03;
          const baseZ = -0.04;

          // CS-ish thrust forward
          k.rotation.x = baseRotX - a * 0.18;
          k.rotation.z = baseRotZ + a * 0.12;
          k.position.y = baseY + a * 0.02;
          k.position.z = baseZ + a * 0.30;
        }
      } catch {}

      // Screen shake disabled.

      // Grenade visual sim (client-side only)
      try {
        if (!window.__lastGrenadeT) window.__lastGrenadeT = performance.now();
        const now = performance.now();
        const dt = Math.min(0.05, (now - window.__lastGrenadeT) / 1000);
        window.__lastGrenadeT = now;
        const grav = -18;
        for (const [id, g] of _grenades.entries()) {
          if (!g.mesh || g.mesh.isDisposed()) { _grenades.delete(id); continue; }
          // fuse cleanup
          if ((Date.now()) >= (g.fuseAt||0) + 200) { try{ g.mesh.dispose(); }catch{}; _grenades.delete(id); continue; }
          g.vy += grav * dt;
          g.mesh.position.x += g.vx * dt;
          g.mesh.position.y += g.vy * dt;
          g.mesh.position.z += g.vz * dt;
          if (g.mesh.position.y <= 1.8) {
            g.mesh.position.y = 1.8;
            if (Math.abs(g.vy) > 1.4) g.vy = Math.abs(g.vy) * 0.55;
            else g.vy = 0;
            g.vx *= 0.94; g.vz *= 0.94;
          }
          g.mesh.rotation.y += 6 * dt;
          g.mesh.rotation.x += 4 * dt;
        }
      } catch {}

      // Smooth remote players
      for (const [id, mesh] of players.entries()) {
        if (id === myId) continue;
        if (!mesh.metadata?.target) continue;
        const lerp = 0.22;
        mesh.position.x += (mesh.metadata.target.x - mesh.position.x) * lerp;
        mesh.position.y += (mesh.metadata.target.y - mesh.position.y) * lerp;
        mesh.position.z += (mesh.metadata.target.z - mesh.position.z) * lerp;
        // shortest-angle yaw lerp (avoid spinning the long way around)
        let dy = (mesh.metadata.targetYaw - mesh.rotation.y);
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        mesh.rotation.y += dy * 0.25;

        // Third-person minigun barrels: spin while spooling/firing.
        try {
          const rotor = mesh.metadata?.weapons?.minigunRotor;
          if (rotor && mesh.metadata?.tppWeaponVisible === 'minigun') {
            const spin = Math.max(0, Math.min(1, mesh.metadata.targetMgSpin || 0));
            rotor.rotation.z += 0.12 + spin * 0.85;
          }
        } catch {}
      }

      try {
        scene.render();
      } catch (e) {
        fatal(e && e.message ? e.message : e);
        return;
      }

      if (socket && socket.readyState === 1 && state.joined) {
        // Keepalive so mobile Safari doesn't silently kill idle websockets in lobby.
        const now = performance.now();
        if (!window._hbPingAt) window._hbPingAt = 0;
        if (now - window._hbPingAt > 5000) {
          window._hbPingAt = now;
          try { socket.send(JSON.stringify({ t:'ping' })); } catch {}
        }

        // disable gameplay input until started
        if (!state.started) return;

        const t = performance.now();
        const dt = Math.min(0.2, (t - lastSend) / 1000);
        if (t - lastSend > 50) {
          lastSend = t;
          // Aim assist: nudge yaw slightly toward closest enemy within a small cone.
          const aimAssistOn = document.getElementById('aimAssist')?.checked;
          if (aimAssistOn && state.shoot && lastServerState && myId) {
            const me = lastServerState.players.find(p => p.id === myId);
            if (me) {
              let best = null;
              for (const p of lastServerState.players) {
                if (p.id === myId) continue;
                if (p.hp <= 0) continue;
                const dx = p.x - me.x;
                const dz = p.z - me.z;
                const dist = Math.hypot(dx, dz);
                if (dist < 0.1 || dist > 18) continue;
                const targetYaw = Math.atan2(dx, dz);
                let dy = targetYaw - state.look.yaw;
                while (dy > Math.PI) dy -= Math.PI*2;
                while (dy < -Math.PI) dy += Math.PI*2;
                const cone = 0.25;
                if (Math.abs(dy) > cone) continue;
                const score = Math.abs(dy) + dist * 0.02;
                if (!best || score < best.score) best = { dy, score };
              }
              if (best) state.look.yaw += best.dy * 0.18; // small nudge
            }
          }

          const wSel = document.getElementById('weapon')?.value;
          const weapon = (
            wSel === 'shotgun' ||
            wSel === 'sniper' ||
            wSel === 'fart' ||
            wSel === 'rocket' ||
            wSel === 'knife' ||
            wSel === 'grenade_frag' ||
            wSel === 'grenade_impact' ||
            wSel === 'minigun'
          ) ? wSel : 'rifle';

          const autoReload = !!document.getElementById('autoReload')?.checked;

          socket.send(JSON.stringify({
            t:'input',
            seq: seq++,
            dt,
            move: state.move,
            look: state.look,
            shoot: !!state.shoot,
            jump: !!state.jump,
            sprint: !!state.sprint,
            weapon,
            autoReload,
          }));
        }
      }
    });

    // Reduce iOS Safari back-swipe accidental navigation.
    // Not a perfect guarantee (browser-level gesture), but helps a lot during gameplay.
    (() => {
      let tracking = false;
      let startX = 0;
      let startY = 0;
      const EDGE = 18; // px

      const onStart = (e) => {
        const t = e.touches && e.touches[0];
        if (!t) return;
        tracking = (t.clientX <= EDGE);
        startX = t.clientX;
        startY = t.clientY;
      };

      const onMove = (e) => {
        if (!tracking) return;
        const t = e.touches && e.touches[0];
        if (!t) return;
        const dx = t.clientX - startX;
        const dy = Math.abs(t.clientY - startY);
        // If it's a mostly-horizontal swipe from the left edge, block it.
        if (dx > 8 && dy < 35) {
          e.preventDefault();
          e.stopPropagation();
        }
      };

      const end = () => { tracking = false; };

      document.addEventListener('touchstart', onStart, { passive: true });
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', end, { passive: true });
      document.addEventListener('touchcancel', end, { passive: true });
    })();

    // iOS: best-effort suppression of double-tap-to-zoom during gameplay.
    // This cannot override Accessibility Zoom, but it prevents the common browser smart-zoom.
    (() => {
      let lastTouchEnd = 0;
      const handler = (e) => {
        const now = Date.now();
        if (now - lastTouchEnd <= 300) {
          e.preventDefault();
        }
        lastTouchEnd = now;
      };
      document.addEventListener('touchend', handler, { passive: false });
      // Also block pinch-zoom gestures where supported.
      document.addEventListener('gesturestart', (e) => { e.preventDefault(); }, { passive: false });
      document.addEventListener('gesturechange', (e) => { e.preventDefault(); }, { passive: false });
      document.addEventListener('gestureend', (e) => { e.preventDefault(); }, { passive: false });
    })();

    window.addEventListener('resize', () => engine.resize());
