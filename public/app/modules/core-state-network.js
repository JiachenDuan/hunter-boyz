    const canvas = document.getElementById('renderCanvas');
    const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });

    let socket = null;
    let myId = null;
    let world = null;

    let roundEndsAtMs = 0;
    let lastTimerStr = null;

    // Connection resilience (mobile browsers drop websockets aggressively in background)
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    let intentionalClose = false;

    const state = {
      move: { x: 0, z: 0 },
      look: { yaw: 0, pitch: 0 },
      shoot: false,
      jump: false,
      sprint: false,
      scope: false,
      joined: false,
      started: false,
      isHost: false,
      settingsOpen: false,
      mapId: 'arena',
    };

    const players = new Map(); // id -> mesh
    let fpRig = null;

    function log(msg) {
      const el = document.getElementById('log');
      if (el) el.textContent = msg;
    }

    // Crash guard: if a runtime error happens on mobile Safari, it can look like a frozen screen.
    // We surface the error + try to reconnect, instead of silently dying.
    let _fatalAt = 0;
    function fatal(msg) {
      const t = Date.now();
      if (t - _fatalAt < 1500) return;
      _fatalAt = t;
      try { console.error('[FATAL]', msg); } catch {}
      try { log(`⚠️ ${String(msg).slice(0, 120)} - reconnecting…`); } catch {}
      try { intentionalClose = false; socket?.close(); } catch {}
      try { setTimeout(() => { try { openSocket(); } catch {} }, 250); } catch {}
    }

    window.addEventListener('error', (e) => {
      try { fatal(e?.message || 'runtime error'); } catch {}
    });
    window.addEventListener('unhandledrejection', (e) => {
      try { fatal((e?.reason && (e.reason.message || String(e.reason))) || 'promise rejection'); } catch {}
    });


    function fmtMs(ms) {
      const s = Math.max(0, Math.ceil(ms / 1000));
      const m = Math.floor(s / 60);
      const r = s % 60;
      return String(m).padStart(2,'0') + ':' + String(r).padStart(2,'0');
    }

    // Round timer UI: avoid a 60fps requestAnimationFrame loop (wastes battery on phones).
    // We tick a few times per second instead; we speed up slightly near the end for responsiveness.
    function timerTickIntervalMs(leftMs) {
      if (!roundEndsAtMs) return 800;          // lobby state
      if (leftMs > 30_000) return 500;         // most of the round
      if (leftMs > 10_000) return 220;         // mid/late
      return 120;                               // last 10s (panic mode)
    }

    function updateRoundTimer() {
      const el = document.getElementById('roundTimer');
      if (!el) {
        setTimeout(updateRoundTimer, 1000);
        return;
      }

      const now = Date.now();
      const left = Math.max(0, (roundEndsAtMs || 0) - now);
      const str = roundEndsAtMs ? fmtMs(left) : 'LOBBY';
      if (str !== lastTimerStr) {
        lastTimerStr = str;
        el.textContent = str;
      }

      setTimeout(updateRoundTimer, timerTickIntervalMs(left));
    }
    setTimeout(updateRoundTimer, 80);

    function setConnState(state /* 'online'|'offline'|'connecting' */) {
      const el = document.getElementById('connDot');
      if (!el) return;
      const txt = document.getElementById('connText');
      const wrap = el.parentElement;

      try {
        if (wrap) {
          wrap.classList.toggle('isConnecting', state === 'connecting');
          wrap.classList.toggle('isOffline', state === 'offline');
          wrap.classList.toggle('isOnline', state === 'online');
        }
      } catch {}

      if (state === 'online') {
        el.style.background = 'rgba(80,255,140,0.95)';
        try {
          const rtt = (typeof window.__lastRttMs === 'number') ? window.__lastRttMs : null;
          if (txt) txt.textContent = (rtt != null) ? `ONLINE ${Math.round(rtt)}ms` : 'ONLINE';
        } catch {
          if (txt) txt.textContent = 'ONLINE';
        }
      }
      else if (state === 'connecting') {
        el.style.background = 'rgba(255,220,100,0.95)';
        if (txt) txt.textContent = 'CONNECTING';
      }
      else {
        el.style.background = 'rgba(255,80,80,0.95)';
        if (txt) txt.textContent = 'OFFLINE';
      }

      try { el.title = (txt?.textContent || state); } catch {}
    }

    function normalizePlayerName(raw) {
      try {
        let s = String(raw || '');
        // Strip control chars/newlines to avoid weird logs/UX issues.
        s = s.replace(/[\u0000-\u001f\u007f]/g, '');
        // Collapse whitespace and trim.
        s = s.replace(/\s+/g, ' ').trim();
        // Keep names reasonably short so HUD/scoreboard don't overflow.
        if (s.length > 16) s = s.slice(0, 16).trimEnd();
        return s;
      } catch {
        return '';
      }
    }

    function connectAndJoin() {
      const nameEl = document.getElementById('name');
      const name = normalizePlayerName(nameEl?.value || 'Hunter') || 'Hunter';
      // UI clarity: ensure the visible input matches the normalized value we actually send.
      // (Prevents confusion when whitespace/control chars are stripped or names are truncated.)
      try { if (nameEl) nameEl.value = name; } catch {}

      const proto = location.protocol === 'https:' ? 'wss' : 'ws';

      // Persistent client id so reconnects replace the old session (prevents "two of myself" bugs).
      let clientId = null;
      try {
        clientId = localStorage.getItem('hunterBoyz.clientId');
        if (!clientId) {
          clientId = (crypto?.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
          localStorage.setItem('hunterBoyz.clientId', clientId);
        }
      } catch {
        clientId = String(Math.random()).slice(2) + Date.now();
      }

      const url = `${proto}://${location.host}`;
      intentionalClose = false;

      function scheduleReconnect() {
        if (intentionalClose) return;
        if (reconnectTimer) return;
        reconnectAttempts = Math.min(reconnectAttempts + 1, 8);
        const delay = Math.min(500 * Math.pow(1.6, reconnectAttempts), 6000);
        setConnState('connecting');
        try {
          const txt = document.getElementById('connText');
          if (txt) txt.textContent = `RECONNECT ${reconnectAttempts}`;
        } catch {}
        log(`Reconnecting… (${Math.round(delay)}ms)`);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          try { openSocket(); } catch {}
        }, delay);
      }

      function openSocket() {
        try { socket?.close(); } catch {}
        setConnState('connecting');
        socket = new WebSocket(url);
        // Expose for automation/debug tooling
        try { window.__socket = socket; } catch {}

        socket.addEventListener('open', () => {
          reconnectAttempts = 0;
          setConnState('online');
          socket.send(JSON.stringify({ t:'join', name, clientId }));
          log('Connected.');

          // RTT ping (UI-only). Kept separate from ws.ping frames.
          try {
            if (window.__rttPingTimer) clearInterval(window.__rttPingTimer);
            window.__rttPingTimer = setInterval(() => {
              try {
                if (socket && socket.readyState === 1) socket.send(JSON.stringify({ t:'ping', at: Date.now() }));
              } catch {}
            }, 2000);
          } catch {}
        });

        socket.addEventListener('message', (ev) => {
          let msg = null;
          try {
            msg = JSON.parse(ev.data);
          } catch (e) {
            try { console.warn('[ws] bad message payload', e); } catch {}
            return;
          }
          if (msg.t === 'welcome') {
            myId = msg.id;
            // Expose for automation/debug tooling (e.g., puppeteer capture scripts)
            try { window.__myId = myId; } catch {}
            world = msg.world;
            state.joined = true;
            joinInFlight = false;
            // Apply immediately so host detection + Start button works even before the next tick.
            if (msg.state) applyState(msg.state);
            trySendStart();
          }
          if (msg.t === 'state') applyState(msg.state);
          if (msg.t === 'pong') {
            try {
              const at = Number(msg.at || 0);
              if (at > 0) {
                const rtt = Math.max(0, Date.now() - at);
                window.__lastRttMs = rtt;
                const txt = document.getElementById('connText');
                if (txt && (txt.textContent || '').startsWith('ONLINE')) txt.textContent = `ONLINE ${Math.round(rtt)}ms`;
              }
            } catch {}
          }
          if (msg.t === 'shot') renderShot(msg);
          if (msg.t === 'kill') showKill(`${msg.killerName || msg.killer} eliminated ${msg.victimName || msg.victim}`);
          if (msg.t === 'winner') showWinner(msg);
          if (msg.t === 'fartPuff') spawnFartPuff(msg.to);
          if (msg.t === 'burn' || msg.t === 'burnDot') { /* burn state handled via player state sync */ }
          if (msg.t === 'fartDot') spawnFartDot(msg.to, msg.dmg || 5);
          if (msg.t === 'explosion') {
            // If we have a matching grenade mesh nearby, delete it immediately so the timing feels right.
            try {
              if (msg.kind === 'grenade' && _grenades && _grenades.size) {
                for (const [gid, g] of _grenades.entries()) {
                  try {
                    const m = g?.mesh;
                    if (!m) continue;
                    const dx = (m.position.x - msg.x);
                    const dz = (m.position.z - msg.z);
                    const d = Math.hypot(dx, dz);
                    if (d < 1.2) { try { m.dispose(); } catch {} _grenades.delete(gid); }
                  } catch {}
                }
              }
            } catch {}
            spawnExplosion(msg);
          }
          if (msg.t === 'grenadeSpawn') onGrenadeSpawn(msg);
          if (msg.t === 'slash') onSlashMsg(msg);
          if (msg.t === 'pickup') {
            showKill(`${msg.id} picked up ${msg.what}`);
            // Immediately switch to minigun in-hand without waiting for next state tick
            if (msg.id === myId && msg.what === 'minigun' && fpRig) {
              try {
                fpRig.setGun('minigun');
              } catch {}
            }
          }
          if (msg.t === 'minigunEmpty') {
            if (msg.id === myId) {
              showKill('⚠️ Minigun out of ammo!');
              // Immediately switch back to selected weapon
              try {
                const sel = document.getElementById('weapon')?.value || 'rifle';
                if (fpRig?.setGun) fpRig.setGun(sel);
              } catch {}
            } else {
              showKill(`${msg.id}'s minigun is empty`);
            }
          }
          if (msg.t === 'dmg') onDamageMsg(msg);
          if (msg.t === 'snapSaved') {
            const url = `${location.origin}/snaps/${msg.file}`;
            log(`Snapshot saved: ${url}`);
          }
        });

        socket.addEventListener('close', () => {
          state.joined = false;
          joinInFlight = false;
          setConnState('offline');
          try {
            joinBtn.disabled = false;
            nameInput.disabled = false;
          } catch {}
          scheduleReconnect();
        });

        socket.addEventListener('error', () => {
          // Error usually followed by close; still schedule reconnect just in case.
          scheduleReconnect();
        });
      }

      openSocket();

      // Best-effort: when the tab is backgrounded/closed, close the socket so the server
      // removes the player immediately (prevents "ghost host" lingering).
      // NOTE: register these listeners once.
      if (!window.__hbConnListeners) {
        window.__hbConnListeners = true;
        const closeSock = () => {
          intentionalClose = true;
          try { socket?.close(); } catch {}
        };
        window.addEventListener('pagehide', closeSock, { passive: true });
        window.addEventListener('beforeunload', closeSock, { passive: true });
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
            closeSock();
          } else {
            // Coming back from background: reconnect.
            if (!socket || socket.readyState > 1) {
              intentionalClose = false;
              try { openSocket(); } catch {}
            }
          }
        }, { passive: true });
      }
    }

    function applyState(s) {
      lastServerState = s;
      // Expose for automated capture tooling
      try { window.__lastState = s; } catch {}

      // If server build changes, force a reload (prevents stale cached JS causing missing buttons/meshes).
      try {
        if (!window.__hbClientBuild) window.__hbClientBuild = String(s.build || '');
        const b = String(s.build || '');
        if (b && window.__hbClientBuild && b !== window.__hbClientBuild) {
          try { showKill('Update applied — reloading…'); } catch {}
          window.__hbClientBuild = b;
          setTimeout(() => { try { location.reload(); } catch {} }, 250);
          return;
        }
      } catch {}
      // game flags
      state.started = !!s.game?.started;
      const _prevStarted = !!applyState._started;
      applyState._started = state.started;
      if (_prevStarted && !state.started) { try { clearDents(); } catch {} }
      // Server-driven round timer (fallback to local if missing)
      if (state.started) {
        const se = (typeof s.game?.roundEndsAt === 'number') ? s.game.roundEndsAt : 0;
        if (se) roundEndsAtMs = se;
        else if (!roundEndsAtMs) roundEndsAtMs = Date.now() + 180000;
      } else {
        roundEndsAtMs = 0;
      }
      state.isHost = (s.game?.hostId && myId) ? (s.game.hostId === myId) : false;
      const nextMapId = String(s.game?.mapId || 'arena');
      if (state.mapId !== nextMapId) {
        state.mapId = nextMapId;
        try {
          const mapEls = [document.getElementById('map'), document.getElementById('mapLobby')].filter(Boolean);
          mapEls.forEach((el) => { try { el.value = nextMapId; } catch {} });
        } catch {}
        try { window.__hbApplyMapVisual?.(nextMapId); } catch {}
        try { clearDents(); } catch {}
      }

      // UI clarity: map selection is only meaningful in the lobby.
      // Disable the selects until you join, and lock them once the round starts.
      try {
        const mapEls = [document.getElementById('map'), document.getElementById('mapLobby')].filter(Boolean);
        const locked = (!state.joined) || state.started;
        mapEls.forEach((el) => {
          try { el.disabled = locked; } catch {}
          try {
            const t = !state.joined ? 'Join to pick map' : (state.started ? 'Map locked during round' : 'Pick map');
            el.title = t;
            el.setAttribute('aria-label', t);
          } catch {}
        });
      } catch {}

      // Build id removed (no longer displayed).

      // lobby UI
      const lobby = document.getElementById('lobby');
      const lobbyPlayers = document.getElementById('lobbyPlayers');
      const startBtn = document.getElementById('startBtn');
      const waitMsg = document.getElementById('waitMsg');
      if (state.joined && !state.started) {
        lobby.style.display = 'flex';
        // keep settings hidden unless user opens it
        settingsPanel.style.display = state.settingsOpen ? 'block' : 'none';
        // Security/UI robustness: avoid innerHTML here so player names/colors can’t inject markup.
        // (Server still treats inputs as untrusted; client should too.)
        const safeCssColor = (c) => {
          // Accept only simple hex or rgb/rgba; fallback to a neutral color.
          if (typeof c !== 'string') return '#888';
          const s = c.trim();
          if (/^#[0-9a-fA-F]{3}$/.test(s)) return s.toLowerCase();
          if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
          const m = s.match(/^rgba?\(([^)]+)\)$/i);
          if (m) {
            const parts = m[1].split(',').map(x => x.trim());
            if (parts.length === 3 || parts.length === 4) {
              const r = Number(parts[0]), g = Number(parts[1]), b = Number(parts[2]);
              const a = parts.length === 4 ? Number(parts[3]) : null;
              const okRgb = [r, g, b].every(n => Number.isFinite(n) && n >= 0 && n <= 255);
              const okA = (a === null) || (Number.isFinite(a) && a >= 0 && a <= 1);
              if (okRgb && okA) {
                return (a === null)
                  ? `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
                  : `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.round(a * 1000) / 1000})`;
              }
            }
          }
          return '#888';
        };

        try { lobbyPlayers.textContent = ''; } catch {}
        const players = Array.isArray(s.players) ? s.players : [];
        players.forEach((p) => {
          const row = document.createElement('div');
          row.style.margin = '6px 0';

          const dot = document.createElement('span');
          dot.style.display = 'inline-block';
          dot.style.width = '10px';
          dot.style.height = '10px';
          dot.style.borderRadius = '999px';
          dot.style.background = safeCssColor(p?.color);
          dot.style.marginRight = '8px';
          row.appendChild(dot);

          const name = String(p?.name || 'Player');
          const id = (typeof p?.id === 'number' || typeof p?.id === 'string') ? String(p.id) : '?';
          row.appendChild(document.createTextNode(`${name} #${id}`));

          if (p?.id === s.game?.hostId) {
            const hostTag = document.createElement('span');
            hostTag.style.opacity = '.75';
            hostTag.textContent = ' (host)';
            row.appendChild(hostTag);
          }

          lobbyPlayers.appendChild(row);
        });

        if (!players.length) {
          const empty = document.createElement('div');
          empty.style.opacity = '.75';
          empty.style.margin = '6px 0';
          empty.textContent = 'No players yet.';
          lobbyPlayers.appendChild(empty);
        }
        startBtn.style.display = 'inline-block';
        startBtn.disabled = false;
        startBtn.style.opacity = '1';
        try {
          const lw = s.game?.lastWinnerName;
          const ls = s.game?.lastWinnerScore;
          if (lw) waitMsg.textContent = `Last winner: ${lw} 🏆${(typeof ls === 'number') ? ` (${ls})` : ''}`;
          else waitMsg.textContent = 'Anyone can tap Start.';
        } catch {
          waitMsg.textContent = 'Anyone can tap Start.';
        }
      } else {
        lobby.style.display = 'none';
        // hide settings while playing unless user explicitly opened it
        if (state.started && !state.settingsOpen) settingsPanel.style.display = 'none';
      }

      // respawn UI + HP bar
      const meP = s.players.find(pp => pp.id === myId);
      const respawn = document.getElementById('respawn');
      if (meP) {
        const hp = Math.max(0, Math.min(100, meP.hp));
        document.getElementById('hpText').textContent = `HP ${hp}`;

        // Debuff indicators
        try {
          const fi = (meP.fartInMs || 0);
          const bi = (meP.burnInMs || 0);
          if (bi > 0) {
            const secs = Math.ceil(bi / 1000);
            document.getElementById('hitDetail').textContent = `🔥 On fire! ${secs}s (-10 HP/s)`;
            document.getElementById('hitDetail').style.opacity = '1';
          } else if (fi > 0) {
            const secs = Math.ceil(fi / 1000);
            document.getElementById('hitDetail').textContent = `💨 Fart cloud ${secs}s (-5 HP/s)`;
            document.getElementById('hitDetail').style.opacity = '1';
          }
        } catch {}
        const fill = document.getElementById('hpFill');
        fill.style.width = `${hp}%`;
        fill.style.background = hp > 60 ? 'rgba(80,255,140,0.85)' : (hp > 30 ? 'rgba(255,220,100,0.85)' : 'rgba(255,80,80,0.85)');

        const ammo = (typeof meP.ammo === 'number') ? meP.ammo : 0;
        const rel = (meP.reloadInMs || 0);
        if (rel > 0) {
          const relSecs = Math.max(0.1, Math.ceil(rel / 100) / 10);
          document.getElementById('ammoText').textContent = `Reloading… ${relSecs.toFixed(1)}s`;
        } else {
          document.getElementById('ammoText').textContent = `Ammo ${ammo}`;
        }
        try {
          const effW = (meP.powerWeapon === 'minigun') ? 'minigun' : (document.getElementById('weapon')?.value || 'rifle');
          const wLabel = (window.WEAPONS?.getWeapon(effW)?.label) || effW;
          const shotW = window.__lastShotWeapon;
          const shotLabel = shotW ? ((window.WEAPONS?.getWeapon(shotW)?.label) || shotW) : '';
          document.getElementById('weaponText').textContent = shotW ? `Weapon ${wLabel} (shot: ${shotLabel})` : `Weapon ${wLabel}`;
        } catch {}

        // Minigun HUD
        try {
          const mgHud = document.getElementById('mgHud');
          const mgAmmo = document.getElementById('mgAmmo');
          const mgHeat = document.getElementById('mgHeat');
          const mgSpinEl = document.getElementById('mgSpin');
          if (meP.powerWeapon === 'minigun') {
            mgHud.style.display = 'flex';
            const maxAmmo = (window.WEAPONS?.getWeapon('minigun')?.ammo) || 300;
            const a = Math.max(0, Math.min(maxAmmo, meP.powerAmmo || 0));
            mgAmmo.style.width = `${(a / maxAmmo) * 100}%`;
            const h = Math.max(0, Math.min(1, meP.mgHeat || 0));
            mgHeat.style.width = `${h * 100}%`;
            if (meP.mgOverheat) mgHeat.style.filter = 'brightness(1.25) saturate(1.2)';
            else mgHeat.style.filter = 'none';
            // Spin indicator (needs >= 20% to fire)
            const spin = Math.max(0, Math.min(1, meP.mgSpin || 0));
            if (mgSpinEl) {
              mgSpinEl.style.width = `${spin * 100}%`;
              mgSpinEl.style.background = spin >= 0.2
                ? 'linear-gradient(90deg, rgba(60,220,120,0.85), rgba(60,255,160,0.85))'
                : 'linear-gradient(90deg, rgba(100,180,255,0.85), rgba(60,140,255,0.85))';
            }
            // Toast: remind player to hold fire during spin-up
            if (state.shoot && spin < 0.2 && !window.__mgSpinToastShown) {
              window.__mgSpinToastShown = true;
              showKill('⟳ Minigun spinning up — hold fire!');
              setTimeout(() => { window.__mgSpinToastShown = false; }, 3000);
            }
          } else {
            mgHud.style.display = 'none';
          }
        } catch {}

        // DROP GUN button: always sync outside the mgHud try/catch so errors can't prevent it hiding
        try {
          const btnDrop = document.getElementById('btnDropMinigun');
          if (btnDrop) btnDrop.style.display = (meP && meP.powerWeapon === 'minigun') ? 'block' : 'none';
        } catch {}

        // EXIT TANK button: show when riding a tank
        try {
          const btnExit = document.getElementById('btnExitTank');
          if (btnExit) btnExit.style.display = (meP && meP.vehicle === 'tank') ? 'block' : 'none';
        } catch {}

        // Pickup prompt (with sticky holdover so pickId doesn't flicker between ticks)
        try {
          const btnPickup = document.getElementById('btnPickup');
          const pickups = (s.pickups || []);
          let show = false;
          let targetId = null;
          // Don't show PICK UP if player already holds a power weapon or vehicle
          if (btnPickup && meP && pickups.length && state.started && !meP.powerWeapon && !meP.vehicle) {
            for (const it of pickups) {
              if (it.type !== 'minigun' && it.type !== 'tank') continue;
              if (it.kind === 'pad' && (it.availInMs||0) > 0) continue;
              if (it.kind === 'drop' && (it.expiresInMs||0) <= 0) continue;
              const dx = (meP.x - it.x);
              const dz = (meP.z - it.z);
              const d = Math.hypot(dx, dz);
              if (d <= 3.0) { show = true; targetId = it.id; break; } // match server pickup radius
            }
          }
          if (btnPickup) {
            if (show) {
              btnPickup.style.display = 'block';
              const pickedIt = pickups.find(x => x.id === targetId);
              btnPickup.textContent = (pickedIt?.type === 'tank') ? 'PICK UP TANK' : 'PICK UP MINIGUN';
              btnPickup.dataset.pickId = targetId;
              btnPickup.dataset.pickIdTs = String(Date.now());
            } else {
              // Sticky: keep showing for 400ms after player walks slightly out of range
              const lastTs = Number(btnPickup.dataset.pickIdTs || 0);
              if (btnPickup.dataset.pickId && (Date.now() - lastTs) < 400) {
                btnPickup.style.display = 'block'; // hold it visible
              } else {
                btnPickup.style.display = 'none';
                btnPickup.dataset.pickId = '';
              }
            }
          }
        } catch {}

        // Tower teleports (mansion)
        try {
          const up = document.getElementById('btnTowerUp');
          const dn = document.getElementById('btnTowerDown');
          if (up) up.style.display = 'none';
          if (dn) dn.style.display = 'none';
          const tps = (s.teleports || []);
          if (meP && state.started && String(s.game?.mapId||'') === 'mansion' && tps.length) {
            const near = (id) => {
              const it = tps.find(x => x.id === id);
              if (!it) return false;
              const d = Math.hypot(meP.x - it.x, meP.z - it.z);
              return d <= 6.0;
            };
            if (up && near('tower_up')) up.style.display = 'block';
            // Down: show when at top or near the down pad
            if (dn && (((meP.y||0) > 16) || near('tower_down'))) dn.style.display = 'block';
          }
        } catch {}

        // Scope UI (sniper)
        updateScopeUI();

        // Keep gun model in sync with current effective weapon (power weapon overrides selection).
        try {
          const eff = (meP.vehicle === 'tank')
            ? 'tank'
            : ((meP.powerWeapon === 'minigun') ? 'minigun' : (document.getElementById('weapon')?.value || 'rifle'));
          if (fpRig?.setGun) fpRig.setGun(eff);
        } catch {}

        // Render 3D pickup pad indicators on the map
        try {
          if (!window.__pickupPadMeshes) window.__pickupPadMeshes = {};
          const pads = window.__pickupPadMeshes;
          const pickupsNow = (s.pickups || []);
          // Mark all existing as stale
          for (const k of Object.keys(pads)) pads[k]._stale = true;
          for (const pk of pickupsNow) {
            const avail = (pk.kind === 'pad') ? ((pk.availInMs||0) <= 0) : ((pk.expiresInMs||0) > 0);
            if (!pads[pk.id]) {
              // Create a glowing crate mesh
              const crate = BABYLON.MeshBuilder.CreateBox('pickup_' + pk.id, { width: 0.8, height: 0.5, depth: 0.8 }, scene);
              const mat = new BABYLON.StandardMaterial('pickMat_' + pk.id, scene);
              mat.diffuseColor = new BABYLON.Color3(1.0, 0.85, 0.2);
              mat.emissiveColor = new BABYLON.Color3(0.6, 0.45, 0.05);
              mat.alpha = 0.85;
              crate.material = mat;
              crate.position.set(pk.x, (pk.y || 0.5) - 0.5, pk.z);
              // Label
              const label = BABYLON.MeshBuilder.CreatePlane('pickLabel_' + pk.id, { width: 1.2, height: 0.4 }, scene);
              const labelTex = new BABYLON.DynamicTexture('pickTex_' + pk.id, { width: 256, height: 64 }, scene, false);
              labelTex.hasAlpha = true;
              const ctx2 = labelTex.getContext();
              ctx2.clearRect(0, 0, 256, 64);
              ctx2.font = 'bold 28px sans-serif';
              ctx2.fillStyle = '#ffd700';
              ctx2.textAlign = 'center';
              ctx2.fillText(pk.type === 'tank' ? '🛡️ TANK' : '⚡ MINIGUN', 128, 42);
              labelTex.update();
              const labelMat = new BABYLON.StandardMaterial('pickLblMat_' + pk.id, scene);
              labelMat.diffuseTexture = labelTex;
              labelMat.emissiveColor = new BABYLON.Color3(1, 0.9, 0.3);
              labelMat.disableLighting = true;
              labelMat.backFaceCulling = false;
              labelMat.useAlphaFromDiffuseTexture = true;
              label.material = labelMat;
              label.position.set(pk.x, (pk.y || 0.5) + 0.6, pk.z);
              label.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
              pads[pk.id] = { crate, label, mat };
            }
            pads[pk.id]._stale = false;
            // Show/hide based on availability
            pads[pk.id].crate.setEnabled(avail);
            pads[pk.id].label.setEnabled(avail);
            // Gentle bob animation
            if (avail) {
              pads[pk.id].crate.position.y = ((pk.y || 0.5) - 0.5) + Math.sin(performance.now() * 0.003) * 0.08;
              pads[pk.id].crate.rotation.y += 0.015;
            }
          }
          // Remove stale
          for (const k of Object.keys(pads)) {
            if (pads[k]._stale) {
              pads[k].crate.dispose();
              pads[k].label.dispose();
              delete pads[k];
            }
          }
        } catch {}

        // Render teleport signposts (mansion tower)
        try {
          const tps = (s.teleports || []).filter(t => t.kind === 'sign');
          if (!window.__teleportSignMeshes) window.__teleportSignMeshes = {};
          const signs = window.__teleportSignMeshes;
          for (const k of Object.keys(signs)) signs[k]._stale = true;
          for (const tp of tps) {
            if (!signs[tp.id]) {
              const plane = BABYLON.MeshBuilder.CreatePlane('tpSign_' + tp.id, { width: 4.2, height: 1.25 }, scene);
              plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
              const dt = new BABYLON.DynamicTexture('tpSignTex_' + tp.id, { width: 512, height: 160 }, scene, false);
              dt.hasAlpha = true;
              const mat = new BABYLON.StandardMaterial('tpSignMat_' + tp.id, scene);
              mat.diffuseTexture = dt;
              mat.emissiveTexture = dt;
              mat.opacityTexture = dt;
              mat.disableLighting = true;
              mat.backFaceCulling = false;
              plane.material = mat;
              signs[tp.id] = { plane, dt, mat };
            }
            const s0 = signs[tp.id];
            s0._stale = false;
            // Position (raise a bit above the pad)
            s0.plane.position.set(tp.x, (tp.y || 1.8) + 2.8, tp.z);

            // Draw
            const ctx = s0.dt.getContext();
            ctx.clearRect(0, 0, 512, 160);
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.strokeStyle = 'rgba(120,200,255,0.70)';
            ctx.lineWidth = 6;
            ctx.beginPath();
            // roundRect shim
            const rr = (x,y,w,h,r) => {
              ctx.moveTo(x+r,y);
              ctx.arcTo(x+w,y,x+w,y+h,r);
              ctx.arcTo(x+w,y+h,x,y+h,r);
              ctx.arcTo(x,y+h,x,y,r);
              ctx.arcTo(x,y,x+w,y,r);
            };
            rr(12, 12, 488, 136, 28);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = 'rgba(230,245,255,0.95)';
            ctx.font = '900 64px system-ui, -apple-system, Segoe UI, Roboto, Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(tp.label || 'TELEPORT'), 256, 82);
            s0.dt.update();

            const pulse = 0.72 + 0.28 * Math.sin(Date.now() / 300);
            try { s0.mat.alpha = pulse; } catch {}
          }
          for (const k of Object.keys(signs)) {
            if (signs[k]._stale) {
              try { signs[k].plane.dispose(); } catch {}
              delete signs[k];
            }
          }
        } catch {}

        // show spawn protection by tinting HP bar
        const inv = (meP.invulnInMs || 0);
        if (inv > 0) {
          fill.style.filter = 'saturate(0.5) brightness(1.2)';
        } else {
          fill.style.filter = 'none';
        }
      }

      if (meP && meP.hp <= 0) {
        respawn.style.display = 'flex';
        const secs = Math.ceil((meP.respawnInMs || 0) / 1000);
        respawn.firstElementChild.textContent = `Respawning… ${secs}s`;
      } else {
        respawn.style.display = 'none';
      }

      // score (avoid innerHTML so player names/colors can't inject markup)
      const scoreDiv = document.getElementById('score');
      if (scoreDiv) {
        // Clear
        while (scoreDiv.firstChild) scoreDiv.removeChild(scoreDiv.firstChild);

        const header = document.createElement('div');
        header.style.fontWeight = '800';
        header.style.marginBottom = '6px';
        header.textContent = 'Score';
        scoreDiv.appendChild(header);

        const sorted = (s.players || []).slice().sort((a,b)=>(b.score||0)-(a.score||0));
        for (const p of sorted) {
          const row = document.createElement('div');

          const dot = document.createElement('span');
          dot.style.display = 'inline-block';
          dot.style.width = '10px';
          dot.style.height = '10px';
          dot.style.borderRadius = '999px';
          // Force color through our hsl()→rgb→hex path (safe for CSS)
          try { dot.style.background = rgbToHex(cssToRgb(p.color)); } catch { dot.style.background = '#c8c8c8'; }
          dot.style.marginRight = '8px';
          row.appendChild(dot);

          const me = p.id === myId ? ' (you)' : '';
          row.appendChild(document.createTextNode(`${p.name || 'Player'}${me}: ${p.score || 0} `));

          const d = document.createElement('span');
          d.style.opacity = '0.8';
          d.textContent = `D ${p.deaths || 0}`;
          row.appendChild(d);

          row.appendChild(document.createTextNode(' '));

          const hp = document.createElement('span');
          hp.style.opacity = '0.65';
          hp.textContent = `HP ${p.hp ?? '-'}`;
          row.appendChild(hp);

          scoreDiv.appendChild(row);
        }
      }

      const liveIds = new Set(s.players.map(p => p.id));
      for (const [id, mesh] of players.entries()) {
        if (!liveIds.has(id)) {
          try {
            const np = mesh?.metadata?.namePlate;
            if (np?.plane) { try { np.plane.dispose(); } catch {} }
            if (np?.dt) { try { np.dt.dispose(); } catch {} }
            const fx = mesh?.metadata?.fartFx;
            if (fx?.parts) { for (const m of fx.parts) { try { m.dispose(); } catch {} } }
            if (fx?.poop) { try { fx.poop.dispose(); } catch {} }
          } catch {}
          mesh.dispose();
          players.delete(id);
        }
      }

      for (const p of s.players) {
        let mesh = players.get(p.id);
        if (!mesh) {
          // Player model (simple low-poly humanoid)
          const root = new BABYLON.TransformNode(`p_${p.id}_root`, scene);

          const mat = new BABYLON.StandardMaterial(`m_${p.id}`, scene);
          mat.diffuseColor = BABYLON.Color3.FromHexString(rgbToHex(cssToRgb(p.color)));
          mat.emissiveColor = mat.diffuseColor.scale(0.15);
          mat.specularColor = new BABYLON.Color3(0,0,0);

          const body = BABYLON.MeshBuilder.CreateCapsule(`p_${p.id}_body`, { radius: 0.35, height: 1.2, subdivisions: 6 }, scene);
          body.parent = root;
          body.position.y = 0.65;
          body.material = mat;

          const head = BABYLON.MeshBuilder.CreateSphere(`p_${p.id}_head`, { diameter: 0.55, segments: 8 }, scene);
          head.parent = root;
          head.position.y = 1.55;
          head.material = mat;

          const armMat = new BABYLON.StandardMaterial(`ma_${p.id}`, scene);
          armMat.diffuseColor = mat.diffuseColor.scale(0.95);
          armMat.emissiveColor = mat.emissiveColor.scale(0.7);
          armMat.specularColor = new BABYLON.Color3(0,0,0);

          const lArm = BABYLON.MeshBuilder.CreateBox(`p_${p.id}_larm`, { width: 0.18, height: 0.5, depth: 0.18 }, scene);
          lArm.parent = root;
          lArm.position.set(-0.42, 1.05, 0.0);
          lArm.rotation.z = 0.15;
          lArm.material = armMat;

          const rArm = BABYLON.MeshBuilder.CreateBox(`p_${p.id}_rarm`, { width: 0.18, height: 0.5, depth: 0.18 }, scene);
          rArm.parent = root;
          rArm.position.set(0.42, 1.05, 0.0);
          rArm.rotation.z = -0.15;
          rArm.material = armMat;

          // A tiny gun block on right arm so others see a weapon
          const gunMat = new BABYLON.StandardMaterial(`mg_${p.id}`, scene);
          gunMat.diffuseColor = new BABYLON.Color3(0.08, 0.09, 0.11);
          gunMat.emissiveColor = new BABYLON.Color3(0.01, 0.01, 0.01);
          gunMat.specularColor = new BABYLON.Color3(0,0,0);

          const gun = BABYLON.MeshBuilder.CreateBox(`p_${p.id}_gun`, { width: 0.12, height: 0.10, depth: 0.30 }, scene);
          gun.parent = root;
          gun.position.set(0.32, 1.05, 0.38);
          gun.material = gunMat;

          // Third-person fishing pole model (shown when weapon === 'fishing_pole')
          const tppFishingPole = new BABYLON.TransformNode(`p_${p.id}_fp`, scene);
          tppFishingPole.parent = root;
          tppFishingPole.position.set(0.32, 1.02, 0.30);

          const rodMat = new BABYLON.StandardMaterial(`fprod_${p.id}`, scene);
          rodMat.diffuseColor = new BABYLON.Color3(0.16, 0.16, 0.18);
          rodMat.specularColor = new BABYLON.Color3(0.20, 0.20, 0.22);
          rodMat.specularPower = 40;

          const fpRod = BABYLON.MeshBuilder.CreateCylinder(`p_${p.id}_fp_rod`, { height: 0.55, diameterTop: 0.010, diameterBottom: 0.018, tessellation: 8 }, scene);
          fpRod.parent = tppFishingPole;
          fpRod.rotation.x = Math.PI / 2;
          fpRod.position.z = 0.20;
          fpRod.material = rodMat;

          const fpGrip = BABYLON.MeshBuilder.CreateCylinder(`p_${p.id}_fp_grip`, { height: 0.14, diameter: 0.024, tessellation: 8 }, scene);
          fpGrip.parent = tppFishingPole;
          fpGrip.rotation.x = Math.PI / 2;
          fpGrip.position.z = -0.04;
          fpGrip.material = gunMat;

          tppFishingPole.setEnabled(false);

          // Third-person minigun model shown when player holds minigun pickup.
          const tppMinigun = new BABYLON.TransformNode(`p_${p.id}_minigun`, scene);
          tppMinigun.parent = root;
          tppMinigun.position.set(0.32, 1.02, 0.34);

          const tppMgRotor = new BABYLON.TransformNode(`p_${p.id}_minigun_rotor`, scene);
          tppMgRotor.parent = tppMinigun;
          tppMgRotor.position.z = 0.20;

          const tppMgHub = BABYLON.MeshBuilder.CreateCylinder(`p_${p.id}_minigun_hub`, { diameter: 0.05, height: 0.30, tessellation: 10 }, scene);
          tppMgHub.parent = tppMgRotor;
          tppMgHub.rotation.x = Math.PI / 2;
          tppMgHub.material = gunMat;

          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const bx = Math.cos(a) * 0.038;
            const by = Math.sin(a) * 0.038;
            const b = BABYLON.MeshBuilder.CreateCylinder(`p_${p.id}_minigun_barrel_${i}`, { diameter: 0.015, height: 0.34, tessellation: 8 }, scene);
            b.parent = tppMgRotor;
            b.rotation.x = Math.PI / 2;
            b.position.set(bx, by, 0);
            b.material = gunMat;
          }
          tppMinigun.setEnabled(false);

          // 3D tank model (shown when player is riding a tank; humanoid hidden)
          const tankBodyMat = new BABYLON.StandardMaterial(`tkbm_${p.id}`, scene);
          tankBodyMat.diffuseColor = new BABYLON.Color3(0.24, 0.31, 0.17);
          tankBodyMat.emissiveColor = new BABYLON.Color3(0.015, 0.020, 0.008);
          tankBodyMat.specularColor = new BABYLON.Color3(0, 0, 0);

          const tankTrackMat = new BABYLON.StandardMaterial(`tktm_${p.id}`, scene);
          tankTrackMat.diffuseColor = new BABYLON.Color3(0.08, 0.08, 0.09);
          tankTrackMat.emissiveColor = new BABYLON.Color3(0.004, 0.004, 0.004);
          tankTrackMat.specularColor = new BABYLON.Color3(0, 0, 0);

          const tppTank = new BABYLON.TransformNode(`p_${p.id}_tank`, scene);
          tppTank.parent = root;

          // Hull (root.y = eye-0.8 ≈ 1.0; hull center world y=0.36 → root-rel = -0.64)
          const tkHull = BABYLON.MeshBuilder.CreateBox(`p_${p.id}_tk_hull`, { width: 1.2, height: 0.72, depth: 1.8 }, scene);
          tkHull.parent = tppTank;
          tkHull.position.y = -0.64;
          tkHull.material = tankBodyMat;

          // Tracks (left + right)
          const tkTrackL = BABYLON.MeshBuilder.CreateBox(`p_${p.id}_tk_tL`, { width: 0.22, height: 0.54, depth: 1.86 }, scene);
          tkTrackL.parent = tppTank;
          tkTrackL.position.set(-0.71, -0.73, 0);
          tkTrackL.material = tankTrackMat;

          const tkTrackR = BABYLON.MeshBuilder.CreateBox(`p_${p.id}_tk_tR`, { width: 0.22, height: 0.54, depth: 1.86 }, scene);
          tkTrackR.parent = tppTank;
          tkTrackR.position.set(0.71, -0.73, 0);
          tkTrackR.material = tankTrackMat;

          // Turret (hull top world y=0.72; turret center at 0.90 → root-rel = -0.10)
          const tkTurret = BABYLON.MeshBuilder.CreateBox(`p_${p.id}_tk_turret`, { width: 0.72, height: 0.36, depth: 0.78 }, scene);
          tkTurret.parent = tppTank;
          tkTurret.position.y = -0.10;
          tkTurret.material = tankBodyMat;

          // Barrel (extends forward from turret)
          const tkBarrel = BABYLON.MeshBuilder.CreateCylinder(`p_${p.id}_tk_barrel`, { diameter: 0.09, height: 1.0, tessellation: 10 }, scene);
          tkBarrel.parent = tppTank;
          tkBarrel.rotation.x = Math.PI / 2;
          tkBarrel.position.set(0, -0.10, 1.40);
          tkBarrel.material = tankTrackMat;

          tppTank.setEnabled(false);

          // 3D nameplate above character (in-world, not UI overlay)
          let namePlate = null;
          try {
            const plane = BABYLON.MeshBuilder.CreatePlane(`name_${p.id}`, { width: 1.6, height: 0.35 }, scene);
            plane.parent = root;
            plane.position.y = 2.35;
            plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
            plane.isPickable = false;

            const dt = new BABYLON.DynamicTexture(`name_dt_${p.id}`, { width: 512, height: 128 }, scene, true);
            dt.hasAlpha = true;
            const ctx = dt.getContext();
            ctx.clearRect(0, 0, 512, 128);
            // background pill
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            roundRect(ctx, 20, 22, 472, 84, 22);
            ctx.fill();
            // text
            ctx.font = 'bold 56px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial';
            ctx.fillStyle = 'rgba(230,237,243,0.95)';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(p.name, 256, 64);
            dt.update();

            const mat = new BABYLON.StandardMaterial(`name_mat_${p.id}`, scene);
            mat.diffuseTexture = dt;
            mat.opacityTexture = dt;
            mat.emissiveColor = new BABYLON.Color3(1,1,1);
            mat.disableLighting = true;
            plane.material = mat;

            namePlate = { plane, dt };
          } catch {}

          // Fart cloud FX (hidden by default)
          let fartFx = null;
          try {
            const poop = new BABYLON.TransformNode(`poop_${p.id}`, scene);
            poop.parent = root;
            poop.position.y = 2.05;

            const cm = new BABYLON.StandardMaterial(`poop_m_${p.id}`, scene);
            cm.diffuseColor = new BABYLON.Color3(0.45, 0.28, 0.12);
            cm.emissiveColor = new BABYLON.Color3(0.05, 0.03, 0.01);
            cm.specularColor = new BABYLON.Color3(0.10, 0.08, 0.06);
            cm.specularPower = 16;
            cm.alpha = 0.0;

            // Simple "poop" shape: 3 stacked spheres
            const s1 = BABYLON.MeshBuilder.CreateSphere(`poop1_${p.id}`, { diameter: 0.46, segments: 8 }, scene);
            s1.parent = poop;
            s1.position.y = 0.00;
            s1.material = cm;
            s1.isPickable = false;

            const s2 = BABYLON.MeshBuilder.CreateSphere(`poop2_${p.id}`, { diameter: 0.34, segments: 8 }, scene);
            s2.parent = poop;
            s2.position.y = 0.20;
            s2.material = cm;
            s2.isPickable = false;

            const s3 = BABYLON.MeshBuilder.CreateSphere(`poop3_${p.id}`, { diameter: 0.22, segments: 8 }, scene);
            s3.parent = poop;
            s3.position.y = 0.36;
            s3.material = cm;
            s3.isPickable = false;

            fartFx = { poop, mat: cm, parts: [s1,s2,s3] };
          } catch {}

          // Burn flame FX (hidden by default) — wraps around player body when burning
          let burnFx = null;
          try {
            const burnRoot = new BABYLON.TransformNode(`burn_${p.id}`, scene);
            burnRoot.parent = root;
            burnRoot.position.y = 0.6; // center of body

            const bm = new BABYLON.StandardMaterial(`burnMat_${p.id}`, scene);
            bm.diffuseColor = new BABYLON.Color3(0, 0, 0);
            bm.emissiveColor = new BABYLON.Color3(1.0, 0.42, 0.08);
            bm.alpha = 0.0;
            bm.disableLighting = true;

            const bm2 = new BABYLON.StandardMaterial(`burnMat2_${p.id}`, scene);
            bm2.diffuseColor = new BABYLON.Color3(0, 0, 0);
            bm2.emissiveColor = new BABYLON.Color3(1.0, 0.75, 0.04);
            bm2.alpha = 0.0;
            bm2.disableLighting = true;

            const burnFlames = [];
            // Ring of flames at body level + higher tongues
            const bfData = [
              { x:  0.28, y: 0.00, z: 0, d: 0.22, mat: bm },
              { x: -0.28, y: 0.00, z: 0, d: 0.22, mat: bm },
              { x:  0,    y: 0.00, z:  0.22, d: 0.20, mat: bm },
              { x:  0,    y: 0.00, z: -0.22, d: 0.20, mat: bm },
              { x:  0.20, y: 0.40, z:  0.10, d: 0.18, mat: bm },
              { x: -0.20, y: 0.40, z: -0.10, d: 0.18, mat: bm },
              { x:  0,    y: 0.65, z:  0,    d: 0.22, mat: bm },
              // Soft outer glow
              { x:  0.36, y: 0.10, z:  0.10, d: 0.32, mat: bm2 },
              { x: -0.30, y: 0.20, z: -0.10, d: 0.30, mat: bm2 },
              { x:  0,    y: 0.50, z:  0.28, d: 0.28, mat: bm2 },
            ];
            bfData.forEach(({ x, y, z, d, mat }, i) => {
              const bf = BABYLON.MeshBuilder.CreateSphere(`bf_${p.id}_${i}`, { diameter: d, segments: 6 }, scene);
              bf.material = mat;
              bf.parent = burnRoot;
              bf.position.set(x, y, z);
              bf.isPickable = false;
              burnFlames.push(bf);
            });

            burnFx = { burnRoot, mat: bm, mat2: bm2, flames: burnFlames };
          } catch {}

          root.metadata = {
            target: new BABYLON.Vector3(p.x, (p.y || 1.8) - 0.8, p.z),
            targetYaw: p.yaw,
            targetMgSpin: 0,
            namePlate,
            fartFx,
            burnFx,
            tppWeaponVisible: 'gun',
            weapons: { gun, minigun: tppMinigun, minigunRotor: tppMgRotor, fishingPole: tppFishingPole },
            tppTank,
            humanoidParts: [body, head, lArm, rArm, gun],
          };
          players.set(p.id, root);
          mesh = root;
        }

        // Hide your own body in first-person (otherwise you see yourself when turning)
        if (p.id === myId) {
          mesh.isVisible = false;
          // Hide your own nameplate too.
          try { if (mesh?.metadata?.namePlate?.plane) mesh.metadata.namePlate.plane.isVisible = false; } catch {}
          ensureFirstPersonRig();
        } else {
          mesh.isVisible = true;
          try { if (mesh?.metadata?.namePlate?.plane) mesh.metadata.namePlate.plane.isVisible = true; } catch {}
        }

        // Smooth other players (reduce jitter)
        if (mesh.metadata) {
          mesh.metadata.target.x = p.x;
          mesh.metadata.target.y = (p.y || 1.8) - 0.8;
          mesh.metadata.target.z = p.z;
          mesh.metadata.targetYaw = p.yaw;
          mesh.metadata.targetMgSpin = p.mgSpin || 0;

          // Fart cloud above head when fart debuff is active
          try {
            const fx = mesh.metadata.fartFx;
            const active = (p.fartInMs || 0) > 0;
            if (fx?.mat) {
              if (active) {
                // gentle pulse + tiny wobble
                const pulse = 0.55 + 0.10 * Math.sin(Date.now() / 120);
                fx.mat.alpha = pulse;
                if (fx.poop) fx.poop.rotation.y = Date.now() / 800;
              } else {
                fx.mat.alpha = 0.0;
              }
            }
          } catch {}

          // Burn flames around body when knife burn debuff is active
          try {
            const bfx = mesh.metadata.burnFx;
            const burning = (p.burnInMs || 0) > 0;
            if (bfx?.mat) {
              if (burning) {
                const nt = Date.now();
                const f1 = Math.sin(nt / 55);
                const f2 = Math.sin(nt / 38 + 1.4);
                const f3 = Math.sin(nt / 90 + 2.8);
                bfx.mat.alpha = 0.60 + 0.22 * f1;
                bfx.mat.emissiveColor.set(1.0, 0.32 + 0.15 * f2, 0.05);
                if (bfx.mat2) {
                  bfx.mat2.alpha = 0.28 + 0.18 * f3;
                  bfx.mat2.emissiveColor.set(1.0, 0.70 + 0.15 * f1, 0.02);
                }
                for (let i = 0; i < (bfx.flames?.length || 0); i++) {
                  const phase = i * 0.7;
                  const sc = 0.85 + 0.30 * Math.sin(nt / 50 + phase);
                  const sy = 1.0 + 0.45 * Math.sin(nt / 40 + phase + 1.2);
                  try {
                    bfx.flames[i].scaling.x = sc;
                    bfx.flames[i].scaling.y = sy;
                    bfx.flames[i].scaling.z = sc;
                  } catch {}
                }
                if (bfx.burnRoot) bfx.burnRoot.rotation.y += 0.025;
              } else {
                bfx.mat.alpha = 0.0;
                if (bfx.mat2) bfx.mat2.alpha = 0.0;
              }
            }
          } catch {}

          // Keep third-person weapon + vehicle mesh in sync.
          try {
            const w = mesh.metadata.weapons;
            const inTank = (p.vehicle === 'tank');
            const hasMinigun = (p.powerWeapon === 'minigun');
            const nextVisible = hasMinigun ? 'minigun' : 'gun';

            // Tank on/off toggle: swap humanoid ↔ tank mesh
            const prevInTank = mesh.metadata._inTank || false;
            if (prevInTank !== inTank) {
              mesh.metadata._inTank = inTank;
              if (mesh.metadata.tppTank) mesh.metadata.tppTank.setEnabled(inTank);
              const hp = mesh.metadata.humanoidParts;
              if (hp) hp.forEach(m => { try { m.setEnabled(!inTank); } catch {} });
            }

            // Weapon visibility (only when not in tank)
            const hasFishingPole = (!hasMinigun && p.weapon === 'fishing_pole');
            const nextVisibleFull = hasMinigun ? 'minigun' : (hasFishingPole ? 'fishing_pole' : 'gun');
            if (!inTank) {
              if (mesh.metadata.tppWeaponVisible !== nextVisibleFull) {
                if (w?.gun) w.gun.setEnabled(nextVisibleFull === 'gun');
                if (w?.minigun) w.minigun.setEnabled(nextVisibleFull === 'minigun');
                if (w?.fishingPole) w.fishingPole.setEnabled(nextVisibleFull === 'fishing_pole');
                mesh.metadata.tppWeaponVisible = nextVisibleFull;
              }
            } else {
              if (w?.gun) w.gun.setEnabled(false);
              if (w?.minigun) w.minigun.setEnabled(false);
              if (w?.fishingPole) w.fishingPole.setEnabled(false);
            }
          } catch {}
        }

        if (p.id !== myId) {
          // actual lerp happens in render loop
        } else {
          mesh.position.x = p.x;
          mesh.position.y = (p.y || 1.8) - 0.8;
          mesh.position.z = p.z;
          mesh.rotation.y = p.yaw;
        }

        if (p.id === myId) {
          camera.position.x = p.x;
          camera.position.y = (p.y || 1.8);
          camera.position.z = p.z;
          camera.rotation.y = p.yaw;
          camera.rotation.x = p.pitch;
          try {
            const eff = (p.vehicle === 'tank') ? 'tank' : ((p.powerWeapon === 'minigun') ? 'minigun' : (document.getElementById('weapon')?.value || 'rifle'));
            fpRig?.setGun?.(eff);
          } catch {}
        }
      }
    }
