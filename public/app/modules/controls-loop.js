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

    function bindRange({ id, storageKey, valId, fmt }) {
      const el = document.getElementById(id);
      if (!el) return;

      // Load persisted value (if any)
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved != null && saved !== '') el.value = String(saved);
      } catch {}

      const valEl = valId ? document.getElementById(valId) : null;
      const render = () => {
        if (!valEl) return;
        const v = parseFloat(el.value);
        valEl.textContent = (fmt ? fmt(v) : String(v));
      };

      render();

      el.addEventListener('input', () => {
        try { localStorage.setItem(storageKey, String(el.value)); } catch {}
        render();
      });
    }

    // UI polish: show + persist important sensitivity/deadzone settings.
    bindRange({ id: 'sensTurn', storageKey: 'hunterBoyz.sensTurn', valId: 'sensTurnVal', fmt: (v) => v.toFixed(1) });
    bindRange({ id: 'sensAim', storageKey: 'hunterBoyz.sensAim', valId: 'sensAimVal', fmt: (v) => v.toFixed(1) });
    bindRange({ id: 'deadzone', storageKey: 'hunterBoyz.deadzone', valId: 'deadzoneVal', fmt: (v) => v.toFixed(2) });

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
        // positive pitch = look down, negative = look up
        // MAX_PITCH=1.5 (~86°) allows aiming down from the tower
        const MIN_PITCH = -1.2; // ~69° up
        const MAX_PITCH = 1.5;  // ~86° down (needed for tower sniping)
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

      // Desktop accessibility: HUD touch buttons are focusable (tabindex=0).
      // Support keyboard "press and hold" semantics via Enter/Space.
      let keyHeld = false;
      const isPressKey = (k) => (k === 'Enter' || k === ' ' || k === 'Spacebar');
      el.addEventListener('keydown', (e) => {
        try {
          if (!isPressKey(e.key)) return;
          prevent(e);
          if (e.repeat) return;
          if (keyHeld) return;
          keyHeld = true;
          press(true);
        } catch {}
      });
      el.addEventListener('keyup', (e) => {
        try {
          if (!isPressKey(e.key)) return;
          prevent(e);
          if (!keyHeld) return;
          keyHeld = false;
          press(false);
        } catch {}
      });
      el.addEventListener('blur', () => {
        try {
          if (!keyHeld) return;
          keyHeld = false;
          press(false);
        } catch {}
      });

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

    // EXIT TANK button
    (() => {
      const el = document.getElementById('btnExitTank');
      if (!el) return;
      const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
      let lastExit = 0;
      const act = (e) => {
        prevent(e);
        const now = Date.now();
        if (now - lastExit < 500) return;
        el.style.background = 'rgba(160,120,30,0.45)';
        setTimeout(() => { el.style.background = 'rgba(160,120,30,0.22)'; }, 150);
        if (!socket || socket.readyState !== 1) { showKill('Server disconnected!'); return; }
        lastExit = now;
        try { socket.send(JSON.stringify({ t:'dropTank' })); } catch {}
      };
      el.addEventListener('pointerdown', act, { passive:false });
    })();

    holdButton(document.getElementById('btnJump'), (v)=> state.jump = v);
    // sprint removed

    // Reload: tap (debounced to avoid iOS double-fire)
    (() => {
      const el = document.getElementById('btnReload');
      const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
      const fire = (e) => {
        prevent(e);
        try { el.classList.add('btnPressed'); setTimeout(() => el.classList.remove('btnPressed'), 90); } catch {}
        if (!socket || socket.readyState !== 1) return;
        socket.send(JSON.stringify({ t:'reload' }));
      };

      let lastReloadAt = 0;
      const fireOnce = (e) => {
        const now = Date.now();
        if (now - lastReloadAt < 450) return;
        lastReloadAt = now;
        fire(e);
      };

      // Use pointerdown only (covers mouse + touch); avoid click/touchend duplicates on mobile Safari.
      el.addEventListener('pointerdown', fireOnce, { passive:false });
    })();

    // Scope: toggle (only affects sniper)
    (() => {
      const el = document.getElementById('btnScope');
      if (!el) return;

      const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };

      function syncScopeButtonA11y() {
        try {
          const w = document.getElementById('weapon')?.value;
          const isSniper = (w === 'sniper');
          el.classList.toggle('isDisabled', !isSniper);

          // Screen readers: expose toggle state + disabled affordance.
          el.setAttribute('aria-disabled', isSniper ? 'false' : 'true');
          el.setAttribute('aria-pressed', (isSniper && state.scope) ? 'true' : 'false');

          // Hover/tooltips (desktop) + long-press hints (mobile).
          if (!isSniper) {
            el.title = 'Scope (Sniper only)';
            el.setAttribute('aria-label', 'Scope (sniper only)');
          } else {
            el.title = `Scope: ${state.scope ? 'ON' : 'OFF'}`;
            el.setAttribute('aria-label', state.scope ? 'Scope on' : 'Scope off');
          }
        } catch {}
      }

      const fire = (e) => {
        prevent(e);
        // Only toggle scope when sniper is selected
        const w = document.getElementById('weapon')?.value;
        if (w !== 'sniper') {
          syncScopeButtonA11y();
          return;
        }
        state.scope = !state.scope;
        updateScopeUI();
        try { el.classList.toggle('btnPressed', state.scope); } catch {}
        syncScopeButtonA11y();
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

      // iOS can deliver both PointerEvents and legacy TouchEvents for the same gesture.
      // Using pointerdown only keeps this single-fire and consistent with the other HUD buttons.
      el.addEventListener('pointerdown', fireOnce, { passive:false });

      // Set the initial affordance on load.
      syncScopeButtonA11y();
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
    const wmTitleEl = document.getElementById('weaponModalTitle');
    const weaponModalHint = document.getElementById('weaponModalHint');
    const wmOpts = document.querySelectorAll('#weaponModalInner .wm-opt');

    function isTouchLike() {
      try {
        // Prefer coarse pointer detection; fall back to touch event presence.
        if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
        if ('ontouchstart' in window) return true;
      } catch {}
      return false;
    }

    function syncModalHints() {
      try {
        const touch = isTouchLike();

        // Keep inline hint text consistent with device modality.
        if (scoreModalHint) {
          scoreModalHint.textContent = touch
            ? 'Tap outside to close'
            : 'Click outside or press Esc • Hold Tab to view';
        }
        if (weaponModalHint) {
          weaponModalHint.textContent = touch
            ? 'Tap a weapon • Tap outside to close'
            : 'Click a weapon • Click outside or press Esc';
        }

        // Small desktop QoL: expose the Tab affordance on hover/tooltips.
        try {
          const sb = document.getElementById('btnScoreboard');
          if (sb) {
            const title = touch ? 'Scoreboard' : 'Scoreboard (hold Tab)';
            sb.title = title;
            sb.setAttribute('aria-label', touch ? 'Open scoreboard' : 'Open scoreboard (hold Tab)');
          }
        } catch {}
      } catch {}
    }
    // Run once on load; device modality rarely changes mid-session.
    syncModalHints();

    function syncPickerHighlight() {
      const cur = weaponEl?.value || 'rifle';
      wmOpts.forEach(o => o.classList.toggle('selected', o.dataset.weapon === cur));

      // UI clarity: echo the selected weapon in the modal title.
      try {
        const curBtn = Array.from(wmOpts).find(o => o.dataset.weapon === cur);
        const label = (curBtn?.textContent || '').trim();
        if (wmTitleEl) wmTitleEl.textContent = label ? `Pick Weapon · ${label}` : 'Pick Weapon';
      } catch {}
    }

    function focusWeaponModal() {
      try {
        const cur = weaponEl?.value || 'rifle';
        const curOpt = Array.from(wmOpts).find(o => o.dataset.weapon === cur);
        const el = curOpt || wmOpts?.[0];
        el?.focus?.({ preventScroll: true });
      } catch {}
    }

    function openWeaponModal() {
      syncPickerHighlight();
      weaponModal?.classList?.add('open');
      try { btnWeaponPick?.classList?.add('isActive'); } catch {}
      // Keyboard QoL: put focus inside the modal on open.
      try { requestAnimationFrame(focusWeaponModal); } catch { try { setTimeout(focusWeaponModal, 0); } catch {} }
    }
    function closeWeaponModal() {
      weaponModal?.classList?.remove('open');
      try { btnWeaponPick?.classList?.remove('isActive'); } catch {}
      // Keyboard QoL: restore focus to the opener.
      try { btnWeaponPick?.focus?.({ preventScroll: true }); } catch {}
    }
    function toggleWeaponModal() {
      try {
        if (weaponModal?.classList?.contains('open')) closeWeaponModal();
        else openWeaponModal();
      } catch {
        try { openWeaponModal(); } catch {}
      }
    }

    btnWeaponPick?.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      toggleWeaponModal();
    });

    weaponModalClose?.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      closeWeaponModal();
    });

    // Tap backdrop to close
    weaponModal?.addEventListener('pointerdown', (e) => {
      if (e.target === weaponModal) { e.preventDefault(); closeWeaponModal(); }
    });

    // Desktop QoL: ESC closes the modal.
    document.addEventListener('keydown', (e) => {
      try {
        if (e.key === 'Escape' && weaponModal?.classList?.contains('open')) {
          e.preventDefault();
          closeWeaponModal();
        }
      } catch {}
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

    function normalizePlayerName(raw) {
      try {
        let s = String(raw || '');
        // Strip control chars/newlines.
        s = s.replace(/[\u0000-\u001f\u007f]/g, '');
        s = s.replace(/\s+/g, ' ').trim();
        if (s.length > 16) s = s.slice(0, 16).trimEnd();
        return s;
      } catch {
        return '';
      }
    }

    // UX: don't let players "join" with an empty name (common on mobile).
    // Also tweak the button label so the disabled state is self-explanatory on touch.
    function syncJoinEnabled() {
      try {
        if (!joinBtn || !nameInput) return;

        if (state.joined) {
          joinBtn.disabled = true;
          joinBtn.textContent = 'Joined';
          try { joinBtn.title = 'Joined'; } catch {}
          try { joinBtn.setAttribute('aria-disabled', 'true'); } catch {}
          try { joinBtn.setAttribute('aria-label', 'Joined'); } catch {}
          return;
        }

        const v = normalizePlayerName(nameInput.value || '');
        const ok = !!v;
        joinBtn.disabled = !ok;
        joinBtn.textContent = ok ? 'Join' : 'Enter name';
        try { joinBtn.title = ok ? 'Join' : 'Enter a name to join'; } catch {}
        try { joinBtn.setAttribute('aria-disabled', joinBtn.disabled ? 'true' : 'false'); } catch {}
        // Keep screen reader intent clear when Join is disabled (common on mobile/touch).
        try { joinBtn.setAttribute('aria-label', ok ? 'Join game' : 'Join game (enter name first)'); } catch {}
      } catch {}
    }
    syncJoinEnabled();
    nameInput?.addEventListener('input', syncJoinEnabled);
    nameInput?.addEventListener('change', syncJoinEnabled);

    // UI clarity: apply the same normalization the server/join flow uses, but only when the
    // player is "done typing" (blur / paste). This avoids cursor-jumps during typing while
    // still preventing surprises like leading/trailing whitespace or >16-char names.
    function normalizeNameInputOnce() {
      try {
        if (!nameInput) return;
        const before = String(nameInput.value || '');
        const after = normalizePlayerName(before);
        if (after !== before) nameInput.value = after;
        syncJoinEnabled();
        // Keep the saved name aligned with what the user sees.
        try { if (after) localStorage.setItem(NAME_KEY, after); } catch {}
      } catch {}
    }
    nameInput?.addEventListener('blur', normalizeNameInputOnce);
    nameInput?.addEventListener('paste', () => { try { setTimeout(normalizeNameInputOnce, 0); } catch {} });

    nameInput?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      doJoin(e);
    });

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

      // Keep the Scope button affordance/semantics in sync with the selected weapon.
      try {
        const el = document.getElementById('btnScope');
        if (el) {
          const isSniper = (weaponEl.value === 'sniper');
          el.classList.toggle('isDisabled', !isSniper);
          el.setAttribute('aria-disabled', isSniper ? 'false' : 'true');
          el.setAttribute('aria-pressed', (isSniper && state.scope) ? 'true' : 'false');
          if (!isSniper) {
            el.title = 'Scope (Sniper only)';
            el.setAttribute('aria-label', 'Scope (sniper only)');
          } else {
            el.title = `Scope: ${state.scope ? 'ON' : 'OFF'}`;
            el.setAttribute('aria-label', state.scope ? 'Scope on' : 'Scope off');
          }
        }
      } catch {}
    });
    const startBtn = document.getElementById('startBtn');
    const snapBtn = document.getElementById('snapBtn');
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    const btnScoreboard = document.getElementById('btnScoreboard');
    const scoreModal = document.getElementById('scoreModal');
    const btnScoreClose = document.getElementById('btnScoreClose');
    const scoreModalHint = document.getElementById('scoreModalHint');
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

      const v = normalizePlayerName(nameInput?.value || '');
      if (!v) {
        try { log('Enter a name to join.'); } catch {}
        try { nameInput?.focus(); } catch {}
        try { syncJoinEnabled(); } catch {}
        return;
      }
      // Normalize the input so reconnect/join uses exactly what the player sees.
      try { if (nameInput) nameInput.value = v; } catch {}

      joinInFlight = true;

      // Disable immediately so duplicate events can't open multiple sockets.
      try {
        joinBtn.disabled = true;
        joinBtn.textContent = 'Joining…';
        try { joinBtn.title = 'Joining…'; } catch {}
        nameInput.disabled = true;
      } catch {}

      // Save name + settings before joining.
      try {
        localStorage.setItem(NAME_KEY, v);
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
    let lastStartAt = 0;
    function trySendStart() {
      if (!pendingStart) return;
      if (!socket || socket.readyState !== 1) return;
      if (!state.joined) return;
      pendingStart = false;
      try { socket.send(JSON.stringify({ t:'start' })); } catch {}
    }

    function doStart(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const now = Date.now();
      // iOS can fire pointerdown + touchend + click; debounce so we only send start once.
      if (now - lastStartAt < 600) return;
      lastStartAt = now;

      sendMapSelection();
      pendingStart = true;
      trySendStart();
    }

    let lastSnapAt = 0;
    function doSnap(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const now = Date.now();
      // iOS can fire pointerdown + touchend + click; debounce to avoid double-uploading snapshots.
      if (now - lastSnapAt < 600) return;
      lastSnapAt = now;

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

    let lastCopyLinkAt = 0;
    async function doCopyLink(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const now = Date.now();
      // iOS can fire pointerdown + touchend + click; debounce so we only copy once.
      if (now - lastCopyLinkAt < 600) return;
      lastCopyLinkAt = now;

      const link = location.href;

      // Quick in-button feedback helps on iPhone (copy success has no visible UI otherwise).
      const originalLabel = (copyLinkBtn?.textContent || 'Copy link');
      let restoreTimer = null;
      function setBtnLabel(label, ms) {
        try { if (copyLinkBtn) copyLinkBtn.textContent = label; } catch {}
        if (restoreTimer) { try { clearTimeout(restoreTimer); } catch {} }
        if (ms) {
          restoreTimer = setTimeout(() => {
            try { if (copyLinkBtn) copyLinkBtn.textContent = originalLabel; } catch {}
            restoreTimer = null;
          }, ms);
        }
      }

      // iOS Safari (and non-HTTPS origins) can reject navigator.clipboard.
      // Provide a low-tech fallback so "Copy Link" works during LAN play.
      async function tryClipboardAPI() {
        if (!navigator.clipboard?.writeText) return false;
        await navigator.clipboard.writeText(link);
        return true;
      }

      function tryExecCommandCopy() {
        const ta = document.createElement('textarea');
        ta.value = link;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        try { document.body.removeChild(ta); } catch {}
        return ok;
      }

      const restoreDisabled = (() => {
        try {
          if (!copyLinkBtn) return () => {};
          const wasDisabled = !!copyLinkBtn.disabled;
          copyLinkBtn.disabled = true;
          return () => { try { copyLinkBtn.disabled = wasDisabled; } catch {} };
        } catch {
          return () => {};
        }
      })();

      setBtnLabel('Copying…', 8000);

      let copied = false;
      try { copied = await tryClipboardAPI().catch(() => false); } catch { copied = false; }
      if (!copied) {
        try { copied = tryExecCommandCopy(); } catch { copied = false; }
      }

      if (copied) {
        setBtnLabel('Copied!', 1100);
        log('Link copied. Paste into the other phone.');
        restoreDisabled();
        return;
      }

      // Fallback: prompt so the user can long-press → Copy.
      // (This works even when clipboard APIs are blocked.)
      try {
        window.prompt('Copy this link:', link);
        setBtnLabel('Copy manually', 1300);
        log('Copy link: select + copy from the prompt.');
      } catch {
        setBtnLabel('Copy failed', 1300);
        log('Copy failed. Link: ' + link);
      } finally {
        restoreDisabled();
      }
    }

    // iOS Safari can be flaky with click depending on viewport/overlays; wire multiple events.
    // But iOS can also fire pointerdown + touchend + click for a single tap.
    // Debounce these action buttons to avoid double-join, double-start, double-snapshot, etc.
    function wireTap(el, fn, debounceMs = 350) {
      if (!el) return;
      let lastAt = 0;
      const handler = (e) => {
        try { e?.preventDefault?.(); } catch {}
        try { e?.stopPropagation?.(); } catch {}
        const now = Date.now();
        if (now - lastAt < debounceMs) return;
        lastAt = now;
        try { fn(e); } catch (err) { console.warn('wireTap handler error', err); }
      };
      el.addEventListener('click', handler);
      el.addEventListener('pointerdown', handler, { passive: false });
      el.addEventListener('touchend', handler, { passive: false });
    }

    wireTap(joinBtn, doJoin);
    wireTap(startBtn, doStart);
    wireTap(snapBtn, doSnap);
    wireTap(copyLinkBtn, doCopyLink);

    // --- Scoreboard modal ---
    // Desktop QoL: focus + ESC-to-close, plus restore focus to the button that opened it.
    // iOS Safari can fire multiple events (pointerdown + touchend + click). Debounce to avoid
    // double-open/double-close flicker or focus weirdness.
    let lastScoreFocus = null;
    let lastScoreToggleAt = 0;
    function doScoreboard(e){
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const now = Date.now();
      if (now - lastScoreToggleAt < 350) return;
      lastScoreToggleAt = now;
      try { lastScoreFocus = document.activeElement; } catch { lastScoreFocus = null; }
      try { scoreModal.style.display = 'flex'; } catch {}
      try { btnScoreClose?.focus?.(); } catch {}
    }
    function doScoreClose(e){
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const now = Date.now();
      if (now - lastScoreToggleAt < 350) return;
      lastScoreToggleAt = now;
      try { scoreModal.style.display = 'none'; } catch {}
      try {
        if (lastScoreFocus && typeof lastScoreFocus.focus === 'function') lastScoreFocus.focus();
        else btnScoreboard?.focus?.();
      } catch {}
    }
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
    // Tap/click backdrop to close (use pointerdown for iOS responsiveness; keep click as fallback).
    if (scoreModal) {
      scoreModal.addEventListener('pointerdown', (e)=>{ if (e.target===scoreModal) doScoreClose(e); }, { passive:false });
      scoreModal.addEventListener('click', (e)=>{ if (e.target===scoreModal) doScoreClose(e); });
    }

    // Desktop QoL: ESC closes scoreboard.
    // Also support "hold Tab to view" like classic shooters.
    let scoreHeldByTab = false;

    function isTypingInField(target) {
      try {
        if (!target) return false;
        const tag = (target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
        if (target.isContentEditable) return true;
      } catch {}
      return false;
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && scoreModal?.style?.display === 'flex') {
        e.preventDefault();
        doScoreClose(e);
        return;
      }

      // Hold Tab to open scoreboard (desktop).
      if (e.key === 'Tab') {
        // Only hijack Tab in-game; don't break form navigation or text entry.
        if (!state.joined) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        if (isTypingInField(e.target)) return;

        // If it's already open via button, just prevent focus-steal.
        if (scoreModal?.style?.display === 'flex') {
          e.preventDefault();
          return;
        }

        e.preventDefault();
        scoreHeldByTab = true;
        doScoreboard(e);
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Tab' && scoreHeldByTab) {
        e.preventDefault();
        scoreHeldByTab = false;
        if (scoreModal?.style?.display === 'flex') doScoreClose(e);
      }
    });

    // Sound is *actually* gated behind a user gesture on iOS/WebAudio.
    // Keep the UI honest: show OFF until we've successfully enabled the audio context.
    let soundEnabled = false;

    function setSoundUI(on) {
      try {
        if (!soundBtn) return;
        const enabled = !!on;
        soundBtn.classList.toggle('soundOn', enabled);
        soundBtn.textContent = enabled ? 'Sound: ON' : 'Sound: OFF';
        soundBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        soundBtn.title = enabled ? 'Sound enabled' : 'Tap to enable sound';
      } catch {}
    }

    function enableSoundNow() {
      if (soundEnabled) return;
      try { SFX.enable(); } catch {}
      try { SFX.hit(); } catch {}
      soundEnabled = true;
      setSoundUI(true);
      try { log('Sound enabled.'); } catch {}
    }

    function doEnableSound(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      enableSoundNow();
    }

    // Audio starts OFF in UI; auto-enable on the first user gesture.
    // (Still requires a gesture on iOS, so we do it as soon as the user touches/clicks anything.)
    setSoundUI(false);
    window.addEventListener('pointerdown', () => { try { enableSoundNow(); } catch {} }, { passive: true, once: true });
    window.addEventListener('touchstart', () => { try { enableSoundNow(); } catch {} }, { passive: true, once: true });

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
      // ── Recoil decay (gun + camera) ──
      try {
        const g = fpRig?.gunRoot;
        if (g) {
          g.metadata = g.metadata || {};
          const baseX = (typeof g.metadata._basePosX === 'number') ? g.metadata._basePosX : 0;
          const baseY = (typeof g.metadata._basePosY === 'number') ? g.metadata._basePosY : 0;
          const baseZ = (typeof g.metadata._basePosZ === 'number') ? g.metadata._basePosZ : 0;
          const baseRotX = (typeof g.metadata._baseRotX === 'number') ? g.metadata._baseRotX : 0;
          const baseRotY = (typeof g.metadata._baseRotY === 'number') ? g.metadata._baseRotY : 0;
          const baseRotZ = (typeof g.metadata._baseRotZ === 'number') ? g.metadata._baseRotZ : 0;

          // Viewmodel spring-back (fast-ish position, slightly slower rotation).
          g.position.x += (baseX - g.position.x) * 0.20;
          g.position.y += (baseY - g.position.y) * 0.20;
          g.position.z += (baseZ - g.position.z) * 0.22;

          g.rotation.x += (baseRotX - g.rotation.x) * 0.13;
          g.rotation.y += (baseRotY - g.rotation.y) * 0.13;
          g.rotation.z += (baseRotZ - g.rotation.z) * 0.13;
        }
      } catch {}

      // Camera recoil is purely visual: apply on top of the authoritative server yaw/pitch.
      // Use a critically-damped-ish spring instead of naive multiplicative decay.
      // Result: recoil "snaps" on shot, then returns smoothly without looking like a linear fade.
      try {
        const baseYaw = (typeof window.__hbBaseYaw === 'number') ? window.__hbBaseYaw : camera.rotation.y;
        const basePitch = (typeof window.__hbBasePitch === 'number') ? window.__hbBasePitch : camera.rotation.x;
        if (typeof window.__camKickPitch !== 'number') window.__camKickPitch = 0;
        if (typeof window.__camKickYaw !== 'number') window.__camKickYaw = 0;
        if (typeof window.__camKickVelPitch !== 'number') window.__camKickVelPitch = 0;
        if (typeof window.__camKickVelYaw !== 'number') window.__camKickVelYaw = 0;

        // Integrate spring toward 0 (recovery). Keep dt clamped so tab hitches don't explode.
        const dt = Math.min(0.05, (engine.getDeltaTime ? (engine.getDeltaTime() / 1000) : 0.016));
        const kPitch = 62; // spring strength
        const cPitch = 16; // damping
        const kYaw = 55;
        const cYaw = 15;

        window.__camKickVelPitch += (-kPitch * window.__camKickPitch - cPitch * window.__camKickVelPitch) * dt;
        window.__camKickVelYaw   += (-kYaw   * window.__camKickYaw   - cYaw   * window.__camKickVelYaw)   * dt;
        window.__camKickPitch    += window.__camKickVelPitch * dt;
        window.__camKickYaw      += window.__camKickVelYaw   * dt;

        // Snap tiny values to 0 (prevents micro-jitter when nearly settled).
        if (Math.abs(window.__camKickPitch) < 0.00006 && Math.abs(window.__camKickVelPitch) < 0.00006) {
          window.__camKickPitch = 0;
          window.__camKickVelPitch = 0;
        }
        if (Math.abs(window.__camKickYaw) < 0.00006 && Math.abs(window.__camKickVelYaw) < 0.00006) {
          window.__camKickYaw = 0;
          window.__camKickVelYaw = 0;
        }

        camera.rotation.x = basePitch + window.__camKickPitch;
        camera.rotation.y = baseYaw + window.__camKickYaw;
      } catch {}
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

      // ── Screen shake (gunfire impulse) ──
      // Apply as an additive camera *position* + tiny roll wobble.
      // We subtract last frame's offset first so we never drift.
      try {
        if (typeof window.__camShakeMag !== 'number') window.__camShakeMag = 0;
        if (typeof window.__camShakePhase !== 'number') window.__camShakePhase = 0;
        if (typeof window.__camShakeLastX !== 'number') window.__camShakeLastX = 0;
        if (typeof window.__camShakeLastY !== 'number') window.__camShakeLastY = 0;
        if (typeof window.__camShakeLastZ !== 'number') window.__camShakeLastZ = 0;
        if (typeof window.__camShakeLastRoll !== 'number') window.__camShakeLastRoll = 0;
        if (typeof window.__camShakeT !== 'number') window.__camShakeT = performance.now();

        // Undo last frame
        camera.position.x -= window.__camShakeLastX;
        camera.position.y -= window.__camShakeLastY;
        camera.position.z -= window.__camShakeLastZ;
        camera.rotation.z -= window.__camShakeLastRoll;

        const now = performance.now();
        const dt = Math.min(0.05, (now - window.__camShakeT) / 1000);
        window.__camShakeT = now;

        // Decay quickly; clamp to 0.
        window.__camShakeMag *= 0.82;
        if (window.__camShakeMag < 0.00015) window.__camShakeMag = 0;

        // Phase advances faster at higher magnitudes for more "violence" on big guns.
        const mag = window.__camShakeMag;
        window.__camShakePhase += dt * (55 + mag * 900);

        // Cheap smooth-ish wobble (deterministic per seed).
        const s = (typeof window.__camShakeSeed === 'number') ? window.__camShakeSeed : 0;
        const p = window.__camShakePhase + s;

        // Translate shake (meters). Keep Y smaller to avoid motion sickness.
        const amt = mag * 2.6;
        const x = Math.sin(p * 1.7) * amt;
        const y = Math.sin(p * 2.3 + 1.2) * amt * 0.35;
        const z = Math.cos(p * 1.9 + 0.7) * amt * 0.55;

        // Tiny roll for "impact" feel.
        const roll = Math.sin(p * 2.1 + 2.4) * (mag * 1.9);

        camera.position.x += x;
        camera.position.y += y;
        camera.position.z += z;
        camera.rotation.z += roll;

        window.__camShakeLastX = x;
        window.__camShakeLastY = y;
        window.__camShakeLastZ = z;
        window.__camShakeLastRoll = roll;
      } catch {}

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

      // Tank engine sound: start looping hum when in tank, stop when leaving
      try {
        const meState = lastServerState?.players?.find(p => p.id === myId);
        const inTank = meState?.vehicle === 'tank';
        if (inTank && !window.__tankEngineRunning) {
          window.__tankEngineRunning = true;
          window.__tankEngineStop = SFX?.tankEngineStart?.();
        } else if (!inTank && window.__tankEngineRunning) {
          window.__tankEngineRunning = false;
          try { window.__tankEngineStop?.(); } catch {}
          window.__tankEngineStop = null;
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
          try { socket.send(JSON.stringify({ t:'ping', at: Date.now() })); } catch {}
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
          const meVehicle = lastServerState?.players?.find(p => p.id === myId)?.vehicle;
          const weapon = (meVehicle === 'tank') ? 'tank' : (
            wSel === 'shotgun' ||
            wSel === 'sniper' ||
            wSel === 'fart' ||
            wSel === 'rocket' ||
            wSel === 'knife' ||
            wSel === 'fishing_pole' ||
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
