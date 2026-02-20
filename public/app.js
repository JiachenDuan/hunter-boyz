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

    function updateRoundTimer() {
      const el = document.getElementById('roundTimer');
      if (!el) return;
      const now = Date.now();
      const left = Math.max(0, (roundEndsAtMs || 0) - now);
      const inLobby = !roundEndsAtMs;
      const str = inLobby ? 'LOBBY' : fmtMs(left);
      if (str !== lastTimerStr) {
        lastTimerStr = str;
        el.textContent = str;
      }
      try { el.classList.toggle('isLobby', inLobby); } catch {}
      requestAnimationFrame(updateRoundTimer);
    }
    requestAnimationFrame(updateRoundTimer);
    function setConnState(state /* 'online'|'offline'|'connecting' */) {
      const el = document.getElementById('connDot');
      if (!el) return;
      const txt = document.getElementById('connText');
      const wrap = el.parentElement;

      try {
        if (wrap) {
          wrap.classList.toggle('isConnecting', state === 'connecting');
        }
      } catch {}

      if (state === 'online') {
        el.style.background = 'rgba(80,255,140,0.95)';
        if (txt) txt.textContent = 'ONLINE';
      }
      else if (state === 'connecting') {
        el.style.background = 'rgba(255,220,100,0.95)';
        if (txt) txt.textContent = 'RECONNECT';
      }
      else {
        el.style.background = 'rgba(255,80,80,0.95)';
        if (txt) txt.textContent = 'OFFLINE';
      }

      try { el.title = (txt?.textContent || state); } catch {}
    }

    function connectAndJoin() {
      const name = (document.getElementById('name').value || 'Hunter').trim();
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

        socket.addEventListener('open', () => {
          reconnectAttempts = 0;
          setConnState('online');
          socket.send(JSON.stringify({ t:'join', name, clientId }));
          log('Connected.');
        });

        socket.addEventListener('message', (ev) => {
          const msg = JSON.parse(ev.data);
          if (msg.t === 'welcome') {
            myId = msg.id;
            world = msg.world;
            state.joined = true;
            joinInFlight = false;
            // Apply immediately so host detection + Start button works even before the next tick.
            if (msg.state) applyState(msg.state);
            trySendStart();
          }
          if (msg.t === 'state') applyState(msg.state);
          if (msg.t === 'shot') renderShot(msg);
          if (msg.t === 'kill') {
            showKill(`${msg.killerName || msg.killer} eliminated ${msg.victimName || msg.victim}`);
            // Local kill-streak hype (party-game chaos): consecutive kills within a short window.
            try {
              if (String(msg.killer) === String(myId)) {
                const now = performance.now();
                const winMs = 4200;
                if (!window.__kb_lastKillAt || (now - window.__kb_lastKillAt) > winMs) window.__kb_streak = 0;
                window.__kb_lastKillAt = now;
                window.__kb_streak = (window.__kb_streak || 0) + 1;

                const n = window.__kb_streak;
                if (n >= 2) {
                  const names = {
                    2: 'DOUBLE KILL',
                    3: 'TRIPLE KILL',
                    4: 'QUAD KILL',
                    5: 'PENTAKILL',
                    6: 'UNSTOPPABLE',
                  };
                  const label = names[n] || `KILL x${n}`;
                  const el = document.getElementById('streakToast');
                  if (el) {
                    el.textContent = `🔥 ${label}!`;
                    el.classList.add('show');
                    clearTimeout(window.__kb_streakT);
                    window.__kb_streakT = setTimeout(() => { try { el.classList.remove('show'); } catch {} }, 900);
                  }
                  try { SFX.hit(); } catch {}
                }
              }
            } catch {}
          }
          if (msg.t === 'winner') showWinner(msg);
          if (msg.t === 'fartPuff') spawnFartPuff(msg.to);
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
          if (msg.t === 'sfx' && msg.kind === 'reload') {
            // play reload tick for nearby players (or self)
            try {
              // If we don't have audio unlocked, this will no-op (fine).
              const me = String(msg.id) === String(myId);
              if (me) { SFX.reload?.(); }
              else {
                // simple distance cull
                const meP = (lastServerState?.players || []).find(p=>String(p.id)===String(myId));
                if (meP) {
                  const dx = (meP.x - msg.x);
                  const dz = (meP.z - msg.z);
                  const d = Math.hypot(dx, dz);
                  if (d < 16) SFX.reload?.();
                }
              }
            } catch {}
          }
          if (msg.t === 'toast' && msg.kind === 'streak') {
            // Server-confirmed streak bonus toast
            try {
              const n = msg.n || 2;
              const label = (n === 2) ? 'DOUBLE' : (n === 3) ? 'TRIPLE' : (n === 4) ? 'QUAD' : (n === 5) ? 'PENTA' : `x${n}`;
              const el = document.getElementById('streakToast');
              if (el) {
                el.textContent = `✨ ${label} BONUS +${msg.bonus || 1}`;
                el.classList.add('show');
                clearTimeout(window.__kb_streakT2);
                window.__kb_streakT2 = setTimeout(() => { try { el.classList.remove('show'); } catch {} }, 900);
              }
              if (String(msg.id) === String(myId)) {
                try { SFX.hit(); } catch {}
              }
            } catch {}
          }
          if (msg.t === 'toast' && msg.kind === 'revenge') {
            try {
              const el = document.getElementById('streakToast');
              if (el) {
                el.textContent = `😈 REVENGE +${msg.bonus || 1}`;
                el.classList.add('show');
                clearTimeout(window.__kb_revengeT);
                window.__kb_revengeT = setTimeout(() => { try { el.classList.remove('show'); } catch {} }, 900);
              }
              if (String(msg.id) === String(myId)) {
                try { SFX.kill(); } catch {}
              }
            } catch {}
          }
          if (msg.t === 'toast' && msg.kind === 'firstblood') {
            try {
              const el = document.getElementById('streakToast');
              if (el) {
                el.textContent = `🩸 FIRST BLOOD +${msg.bonus || 1}`;
                el.classList.add('show');
                clearTimeout(window.__kb_firstBloodT);
                window.__kb_firstBloodT = setTimeout(() => { try { el.classList.remove('show'); } catch {} }, 1000);
              }
              if (String(msg.id) === String(myId)) {
                try { SFX.kill(); } catch {}
              }
            } catch {}
          }
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
      // game flags
      state.started = !!s.game?.started;
      const _prevStarted = !!applyState._started;
      applyState._started = state.started;
      if (_prevStarted && !state.started) { try { clearDents(); } catch {} }
      // Server-driven round timer (fallback to local if missing)
      if (state.started) {
        const se = (typeof s.game?.roundEndsAt === 'number') ? s.game.roundEndsAt : 0;
        if (se) roundEndsAtMs = se;
        else if (!roundEndsAtMs) roundEndsAtMs = Date.now() + 120000;
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
        lobbyPlayers.innerHTML = s.players.map(p => {
          const tag = p.id === s.game?.hostId ? ' <span style="opacity:.75">(host)</span>' : '';
          const label = `${p.name} #${p.id}`;
          return `<div style="margin:6px 0;"><span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:${p.color};margin-right:8px;"></span>${label}${tag}</div>`;
        }).join('');
        startBtn.style.display = 'inline-block';
        startBtn.disabled = false;
        startBtn.style.opacity = '1';
        waitMsg.textContent = 'Anyone can tap Start.';
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

        // Fart debuff indicator
        try {
          const fi = (meP.fartInMs || 0);
          if (fi > 0) {
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
        const ammoEl = document.getElementById('ammoText');
        if (ammoEl) {
          ammoEl.textContent = rel > 0 ? `Reloading…` : `Ammo ${ammo}`;
          try {
            ammoEl.classList.toggle('isReloading', rel > 0);
            ammoEl.classList.toggle('isLow', rel <= 0 && ammo <= 3);
          } catch {}
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

        // Pickup prompt (with sticky holdover so pickId doesn't flicker between ticks)
        try {
          const btnPickup = document.getElementById('btnPickup');
          const pickups = (s.pickups || []);
          let show = false;
          let targetId = null;
          // Don't show PICK UP if player already holds the minigun
          if (btnPickup && meP && pickups.length && state.started && !meP.powerWeapon) {
            for (const it of pickups) {
              if (it.type !== 'minigun') continue;
              if (it.kind === 'pad' && (it.availInMs||0) > 0) continue;
              if (it.kind === 'drop' && (it.expiresInMs||0) <= 0) continue;
              const dx = (meP.x - it.x);
              const dz = (meP.z - it.z);
              const d = Math.hypot(dx, dz);
              if (d <= 3.5) { show = true; targetId = it.id; break; } // wider radius for reliability
            }
          }
          if (btnPickup) {
            if (show) {
              btnPickup.style.display = 'block';
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

        // Scope UI (sniper)
        updateScopeUI();

        // Keep gun model in sync with current effective weapon (power weapon overrides selection).
        try {
          const eff = (meP.powerWeapon === 'minigun') ? 'minigun' : (document.getElementById('weapon')?.value || 'rifle');
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
              ctx2.fillText('⚡ MINIGUN', 128, 42);
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

        // show spawn protection by tinting HP bar + small HUD hint
        const inv = (meP.invulnInMs || 0);
        if (inv > 0) {
          fill.style.filter = 'saturate(0.5) brightness(1.2)';
          try {
            const secs = Math.ceil(inv / 1000);
            document.getElementById('hpText').textContent = `HP ${hp}  🛡️ ${secs}s`;
          } catch {}
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

      // score
      const scoreDiv = document.getElementById('score');
      scoreDiv.innerHTML = '<div style="font-weight:800; margin-bottom:6px;">Score</div>' +
        s.players.sort((a,b)=>b.score-a.score).map(p => {
          const me = p.id === myId ? ' (you)' : '';
          return `<div><span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:${p.color};margin-right:8px;"></span>${p.name}${me}: ${p.score} <span style="opacity:.8">D ${p.deaths||0}</span> <span style="opacity:.65">HP ${p.hp}</span></div>`;
        }).join('');

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

          root.metadata = {
            target: new BABYLON.Vector3(p.x, (p.y || 1.8) - 0.8, p.z),
            targetYaw: p.yaw,
            targetMgSpin: 0,
            namePlate,
            fartFx,
            tppWeaponVisible: 'gun',
            weapons: { gun, minigun: tppMinigun, minigunRotor: tppMgRotor },
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

          // Keep third-person weapon mesh in sync with power weapon state.
          try {
            const w = mesh.metadata.weapons;
            const hasMinigun = (p.powerWeapon === 'minigun');
            const nextVisible = hasMinigun ? 'minigun' : 'gun';
            if (mesh.metadata.tppWeaponVisible !== nextVisible) {
              if (w?.gun) w.gun.setEnabled(!hasMinigun);
              if (w?.minigun) w.minigun.setEnabled(hasMinigun);
              mesh.metadata.tppWeaponVisible = nextVisible;
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
            const eff = (p.powerWeapon === 'minigun') ? 'minigun' : (document.getElementById('weapon')?.value || 'rifle');
            fpRig?.setGun?.(eff);
          } catch {}
        }
      }
    }
    // Helpers to parse hsl() to rgb
    function roundRect(ctx, x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }

    function cssToRgb(css) {
      // expects hsl(h s% l%)
      const m = css.match(/hsl\(([-\d.]+)\s+([\d.]+)%\s+([\d.]+)%\)/);
      if (!m) return {r:200,g:200,b:200};
      const h = (+m[1]) / 360;
      const s = (+m[2]) / 100;
      const l = (+m[3]) / 100;
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      let r,g,b;
      if (s === 0) {
        r=g=b=l;
      } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
      }
      return { r: Math.round(r*255), g: Math.round(g*255), b: Math.round(b*255) };
    }
    function rgbToHex({r,g,b}) {
      return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
    }

    // Scene
    const scene = new BABYLON.Scene(engine);
    const DEFAULT_FOV = 0.9;
    const SCOPE_FOV = 0.35;
    // More colorful vibe
    scene.clearColor = new BABYLON.Color4(0.72, 0.86, 0.98, 1);

    const light = new BABYLON.HemisphericLight('h', new BABYLON.Vector3(0, 1, 0), scene);
    light.intensity = 0.95;

    const dir = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.4, -1, 0.2), scene);
    dir.intensity = 0.55;

    // Subtle sky gradient (big inverted sphere)
    const sky = BABYLON.MeshBuilder.CreateSphere('sky', { diameter: 500, segments: 12 }, scene);
    sky.infiniteDistance = true;
    sky.isPickable = false;
    sky.scaling.x = -1;
    const skyMat = new BABYLON.StandardMaterial('skyMat', scene);
    skyMat.backFaceCulling = false;
    skyMat.disableLighting = true;
    skyMat.diffuseColor = new BABYLON.Color3(0,0,0);
    // Fake gradient by using emissive color + vertex colors-like effect via fresnel
    // Light-blue sky vibe
    skyMat.emissiveColor = new BABYLON.Color3(0.55, 0.75, 0.95);
    skyMat.emissiveFresnelParameters = new BABYLON.FresnelParameters();
    skyMat.emissiveFresnelParameters.bias = 0.15;
    skyMat.emissiveFresnelParameters.power = 1.6;
    skyMat.emissiveFresnelParameters.leftColor = new BABYLON.Color3(0.82, 0.92, 1.00);
    skyMat.emissiveFresnelParameters.rightColor = new BABYLON.Color3(0.35, 0.70, 0.98);
    sky.material = skyMat;

    const camera = new BABYLON.UniversalCamera('cam', new BABYLON.Vector3(0, 2, -5), scene);
    camera.fov = DEFAULT_FOV;
    camera.minZ = 0.05;

    // Ground + some blocks
    const ground = BABYLON.MeshBuilder.CreateGround('g', { width: 60, height: 60 }, scene);
    ground.isPickable = true;
    // Floor: make it feel like a real floor (grass-ish)
    const gmat = new BABYLON.StandardMaterial('gm', scene);
    gmat.diffuseColor = new BABYLON.Color3(0.22, 0.50, 0.28);
    gmat.emissiveColor = new BABYLON.Color3(0.03, 0.06, 0.03);
    gmat.specularColor = new BABYLON.Color3(0,0,0);
    ground.material = gmat;

    // World boundary walls (visual only) so you can tell when you're at map edge.
    (() => {
      const bounds = { minX: -25, maxX: 25, minZ: -25, maxZ: 25 };
      const h = 6;
      const thickness = 0.25;

      // Simple emissive grid texture
      const dt = new BABYLON.DynamicTexture('wallGrid', { width: 512, height: 512 }, scene, true);
      dt.hasAlpha = true;
      const ctx = dt.getContext();
      ctx.clearRect(0, 0, 512, 512);
      ctx.fillStyle = 'rgba(0,0,0,0.0)';
      ctx.fillRect(0, 0, 512, 512);
      // grid lines
      ctx.strokeStyle = 'rgba(120, 220, 255, 0.65)';
      ctx.lineWidth = 2;
      const step = 64;
      for (let x = 0; x <= 512; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
      }
      for (let y = 0; y <= 512; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
      }
      // border
      ctx.strokeStyle = 'rgba(255, 240, 120, 0.85)';
      ctx.lineWidth = 10;
      ctx.strokeRect(6, 6, 500, 500);
      dt.update();

      const wallMat = new BABYLON.StandardMaterial('wallMat', scene);
      wallMat.diffuseTexture = dt;
      wallMat.opacityTexture = dt;
      wallMat.emissiveTexture = dt;
      wallMat.emissiveColor = new BABYLON.Color3(0.75, 1.0, 1.0);
      wallMat.disableLighting = true;
      wallMat.backFaceCulling = false;
      wallMat.alpha = 0.78;

      function wall(name, x, z, w, d, rotY) {
        const m = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
        m.position.set(x, h / 2, z);
        m.rotation.y = rotY || 0;
        m.material = wallMat;
        // Pickable so bullet marks can land on boundary walls.
        m.isPickable = true;
        return m;
      }

      const midX = (bounds.minX + bounds.maxX) / 2;
      const midZ = (bounds.minZ + bounds.maxZ) / 2;
      const sizeX = (bounds.maxX - bounds.minX);
      const sizeZ = (bounds.maxZ - bounds.minZ);

      // North/South (Z walls)
      wall('wallN', midX, bounds.maxZ, sizeX + thickness, thickness, 0);
      wall('wallS', midX, bounds.minZ, sizeX + thickness, thickness, 0);
      // East/West (X walls)
      wall('wallE', bounds.maxX, midZ, thickness, sizeZ + thickness, 0);
      wall('wallW', bounds.minX, midZ, thickness, sizeZ + thickness, 0);
    })();

    function ensureFirstPersonRig() {
      if (fpRig) return fpRig;
      const root = new BABYLON.TransformNode('fpRoot', scene);
      root.parent = camera;

      // Hands (very simple blocks)
      const handMat = new BABYLON.StandardMaterial('handMat', scene);
      handMat.diffuseColor = new BABYLON.Color3(0.85, 0.72, 0.62);
      handMat.specularColor = new BABYLON.Color3(0,0,0);

      // First-person rig (more hand/gun-like using capsules + better proportions)
      const skinMat = new BABYLON.StandardMaterial('skinMat', scene);
      skinMat.diffuseColor = new BABYLON.Color3(0.90, 0.76, 0.66);
      skinMat.specularColor = new BABYLON.Color3(0.05,0.05,0.05);

      function capsule(name, radius, height) {
        return BABYLON.MeshBuilder.CreateCapsule(name, { radius, height, subdivisions: 6 }, scene);
      }

      function makeHand(name, side /* -1 left, +1 right */, parent) {
        const handRoot = new BABYLON.TransformNode(name, scene);
        handRoot.parent = parent;

        // Palm
        const palm = BABYLON.MeshBuilder.CreateBox(name + '_palm', { width: 0.09, height: 0.03, depth: 0.12 }, scene);
        palm.material = skinMat;
        palm.parent = handRoot;
        palm.position.set(0, 0, 0);

        // Fingers (4 capsules) curled around grip
        const fingerOffsets = [-0.030, -0.010, 0.010, 0.030];
        const fingers = [];
        for (let i = 0; i < 4; i++) {
          const f = capsule(`${name}_f${i}`, 0.012, 0.08);
          f.material = skinMat;
          f.parent = handRoot;
          f.position.set(fingerOffsets[i], -0.018, 0.055);
          f.rotation.x = 1.15; // curl
          fingers.push(f);
        }

        // Thumb
        const thumb = capsule(name + '_thumb', 0.012, 0.07);
        thumb.material = skinMat;
        thumb.parent = handRoot;
        thumb.position.set(0.05 * side, -0.005, 0.010);
        thumb.rotation.z = -0.9 * side;
        thumb.rotation.x = 0.6;

        return { handRoot, palm, fingers, thumb };
      }

      // Left forearm + hand
      const lFore = capsule('lFore', 0.055, 0.30);
      lFore.material = skinMat;
      lFore.parent = root;
      lFore.position.set(-0.20, -0.24, 0.60);
      lFore.rotation.x = 0.35;
      lFore.rotation.z = 0.18;

      const leftHand = makeHand('leftHand', -1, root);
      leftHand.handRoot.position.set(-0.20, -0.34, 0.76);
      leftHand.handRoot.rotation.x = 0.15;
      leftHand.handRoot.rotation.z = 0.10;

      // Right forearm + hand
      const rFore = capsule('rFore', 0.055, 0.30);
      rFore.material = skinMat;
      rFore.parent = root;
      rFore.position.set(0.22, -0.24, 0.60);
      rFore.rotation.x = 0.40;
      rFore.rotation.z = -0.15;

      const rightHand = makeHand('rightHand', +1, root);
      rightHand.handRoot.position.set(0.22, -0.35, 0.78);
      rightHand.handRoot.rotation.x = 0.12;
      rightHand.handRoot.rotation.z = -0.08;

      // Jiachen: hide hands/forearms; keep only the gun visible in first-person.
      try {
        lFore.isVisible = false;
        rFore.isVisible = false;
        leftHand.handRoot.setEnabled(false);
        rightHand.handRoot.setEnabled(false);
      } catch {}

      // Gun models (simple primitives per weapon). This avoids asset loading issues on iPhone.
      const gunRoot = new BABYLON.TransformNode('gunRoot', scene);
      gunRoot.parent = root;
      gunRoot.position.set(0.08, -0.30, 0.80);

      // Gun materials (cheap but more realistic: metal + accent)
      const gunMat = new BABYLON.StandardMaterial('gunMat', scene);
      gunMat.diffuseColor = new BABYLON.Color3(0.14, 0.15, 0.17);
      gunMat.emissiveColor = new BABYLON.Color3(0.01, 0.01, 0.012);
      gunMat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.28);
      gunMat.specularPower = 64;

      const accentMat = new BABYLON.StandardMaterial('gunAccentMat', scene);
      accentMat.diffuseColor = new BABYLON.Color3(0.10, 0.10, 0.11);
      accentMat.emissiveColor = new BABYLON.Color3(0.005, 0.005, 0.006);
      accentMat.specularColor = new BABYLON.Color3(0.18, 0.18, 0.20);
      accentMat.specularPower = 48;

      const gripMat = new BABYLON.StandardMaterial('gunGripMat', scene);
      gripMat.diffuseColor = new BABYLON.Color3(0.06, 0.06, 0.065);
      gripMat.emissiveColor = new BABYLON.Color3(0.003, 0.003, 0.003);
      gripMat.specularColor = new BABYLON.Color3(0.04, 0.04, 0.04);
      gripMat.specularPower = 12;

      // Wood material (AK-style furniture)
      const woodMat = new BABYLON.StandardMaterial('woodMat', scene);
      woodMat.diffuseColor = new BABYLON.Color3(0.28, 0.16, 0.08);
      woodMat.emissiveColor = new BABYLON.Color3(0.02, 0.01, 0.005);
      woodMat.specularColor = new BABYLON.Color3(0.10, 0.08, 0.06);
      woodMat.specularPower = 24;

      // ── Fancy gun skins (procedural; no external assets) ──
      // Uses a low-res DynamicTexture so it looks like a "skin" but stays iPhone-friendly.
      function gunSkinMat(name, opts = {}) {
        const size = opts.size || 256;
        const base = opts.base || '#12151a';
        const accent = opts.accent || '#4aa3ff';
        const accent2 = opts.accent2 || '#d7ff4f';
        const pattern = opts.pattern || 'digital'; // digital|diagonal|fade|camo

        const tex = new BABYLON.DynamicTexture(`skinTex_${name}`, { width: size, height: size }, scene, false);
        const ctx = tex.getContext();

        function rand(seed) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return [seed, (seed & 0xfffffff) / 0xfffffff];
        }
        let seed = (opts.seed || 123456789) >>> 0;

        // base fill
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, size, size);

        // subtle vignette / depth
        const vg = ctx.createRadialGradient(size * 0.4, size * 0.35, size * 0.1, size * 0.5, size * 0.5, size * 0.75);
        vg.addColorStop(0, 'rgba(255,255,255,0.05)');
        vg.addColorStop(1, 'rgba(0,0,0,0.18)');
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, size, size);

        // pattern layer (kept more "CS skin" than neon toy)
        if (pattern === 'diagonal') {
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = accent;
          for (let i = -size; i < size * 2; i += 26) {
            ctx.save();
            ctx.translate(i, 0);
            ctx.rotate(-Math.PI / 4);
            ctx.fillRect(0, 0, 8, size * 3);
            ctx.restore();
          }
          ctx.globalAlpha = 1;
        } else if (pattern === 'fade') {
          const g2 = ctx.createLinearGradient(0, size, size, 0);
          g2.addColorStop(0, base);
          g2.addColorStop(0.55, accent);
          g2.addColorStop(1, accent2);
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = g2;
          ctx.fillRect(0, 0, size, size);
          ctx.globalAlpha = 1;
        } else if (pattern === 'camo') {
          ctx.globalAlpha = 0.28;
          for (let i = 0; i < 120; i++) {
            let r;
            [seed, r] = rand(seed); const x = Math.floor(r * size);
            [seed, r] = rand(seed); const y = Math.floor(r * size);
            [seed, r] = rand(seed); const w = 14 + Math.floor(r * 60);
            [seed, r] = rand(seed); const h = 10 + Math.floor(r * 46);
            [seed, r] = rand(seed);
            ctx.fillStyle = (r < 0.6) ? accent : accent2;
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, 6);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        } else {
          // digital (default)
          ctx.globalAlpha = 0.26;
          for (let i = 0; i < 180; i++) {
            let r;
            [seed, r] = rand(seed); const x = Math.floor(r * size);
            [seed, r] = rand(seed); const y = Math.floor(r * size);
            [seed, r] = rand(seed); const w = 8 + Math.floor(r * 22);
            [seed, r] = rand(seed); const h = 6 + Math.floor(r * 18);
            [seed, r] = rand(seed);
            ctx.fillStyle = (r < 0.72) ? accent : accent2;
            ctx.fillRect(x, y, w, h);
          }
          ctx.globalAlpha = 1;
        }

        // "brushed metal" micro lines (helps read as real material)
        ctx.globalAlpha = 0.10;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        for (let y = 0; y < size; y += 4) {
          ctx.beginPath();
          ctx.moveTo(0, y + ((y % 8) ? 0.5 : 0));
          ctx.lineTo(size, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // tiny decals (serial-ish)
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial';
        ctx.fillText(String(opts.decal || name).toUpperCase().slice(0, 10), 14, size - 18);
        ctx.globalAlpha = 1;

        tex.update(false);
        try {
          tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
          tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
          tex.uScale = opts.uScale || 2.0;
          tex.vScale = opts.vScale || 2.0;
        } catch {}

        // PBR for more "real" look
        const m = new BABYLON.PBRMetallicRoughnessMaterial(`skinMat_${name}`, scene);
        m.baseTexture = tex;
        m.metallic = (typeof opts.metallic === 'number') ? opts.metallic : 0.65;
        m.roughness = (typeof opts.roughness === 'number') ? opts.roughness : 0.35;
        m.baseColor = new BABYLON.Color3(1, 1, 1);
        return m;
      }

      // Default fancy skins (CS-ish, but slightly stylized)
      const skinRifleMat = gunSkinMat('rifle', { seed: 4101, base: '#11151b', accent: '#2f7cff', accent2: '#e6e6e6', pattern: 'digital', decal: 'HB-RIFLE', uScale: 2.4, vScale: 2.4, metallic: 0.60, roughness: 0.40 });
      const skinShotgunMat = gunSkinMat('shotgun', { seed: 8822, base: '#141416', accent: '#ff8c1a', accent2: '#b000ff', pattern: 'diagonal', decal: 'HB-SG', uScale: 2.2, vScale: 2.2, metallic: 0.55, roughness: 0.45 });
      const skinMinigunMat = gunSkinMat('minigun', { seed: 12007, base: '#0f1216', accent: '#ff2d55', accent2: '#ffd60a', pattern: 'camo', decal: 'HB-MG', uScale: 2.0, vScale: 2.0, metallic: 0.70, roughness: 0.30 });
      const skinSniperMat = gunSkinMat('sniper', { seed: 7711, base: '#0e100f', accent: '#1a1e1c', accent2: '#2a2f2b', pattern: 'fade', decal: 'HB-AWP', uScale: 2.0, vScale: 2.0, metallic: 0.50, roughness: 0.55 });
      const skinRocketMat = gunSkinMat('rocket', { seed: 9090, base: '#0f1216', accent: '#ff3b30', accent2: '#ffd60a', pattern: 'diagonal', decal: 'HB-RPG', uScale: 1.8, vScale: 1.8, metallic: 0.45, roughness: 0.55 });
      const skinFartMat = gunSkinMat('fart', { seed: 2501, base: '#13161b', accent: '#27e18c', accent2: '#ffd60a', pattern: 'digital', decal: 'FART', uScale: 2.6, vScale: 2.6, metallic: 0.25, roughness: 0.65 });


      // Cartoon / toy palette (bright colors + low specular)
      const toyBlueMat = new BABYLON.StandardMaterial('toyBlueMat', scene);
      toyBlueMat.diffuseColor = new BABYLON.Color3(0.15, 0.55, 0.95);
      toyBlueMat.emissiveColor = new BABYLON.Color3(0.02, 0.04, 0.06);
      toyBlueMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);

      const toyRedMat = new BABYLON.StandardMaterial('toyRedMat', scene);
      toyRedMat.diffuseColor = new BABYLON.Color3(0.95, 0.20, 0.25);
      toyRedMat.emissiveColor = new BABYLON.Color3(0.06, 0.02, 0.02);
      toyRedMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);

      const toyPurpleMat = new BABYLON.StandardMaterial('toyPurpleMat', scene);
      toyPurpleMat.diffuseColor = new BABYLON.Color3(0.62, 0.28, 0.95);
      toyPurpleMat.emissiveColor = new BABYLON.Color3(0.04, 0.02, 0.06);
      toyPurpleMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);

      const toyGreenMat = new BABYLON.StandardMaterial('toyGreenMat', scene);
      toyGreenMat.diffuseColor = new BABYLON.Color3(0.25, 0.92, 0.45);
      toyGreenMat.emissiveColor = new BABYLON.Color3(0.02, 0.06, 0.03);
      toyGreenMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);

      const toyOrangeMat = new BABYLON.StandardMaterial('toyOrangeMat', scene);
      toyOrangeMat.diffuseColor = new BABYLON.Color3(0.98, 0.55, 0.18);
      toyOrangeMat.emissiveColor = new BABYLON.Color3(0.06, 0.03, 0.01);
      toyOrangeMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);

      const toyYellowMat = new BABYLON.StandardMaterial('toyYellowMat', scene);
      toyYellowMat.diffuseColor = new BABYLON.Color3(0.98, 0.92, 0.20);
      toyYellowMat.emissiveColor = new BABYLON.Color3(0.06, 0.05, 0.01);
      toyYellowMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);

      const toyWhiteMat = new BABYLON.StandardMaterial('toyWhiteMat', scene);
      toyWhiteMat.diffuseColor = new BABYLON.Color3(0.92, 0.92, 0.95);
      toyWhiteMat.emissiveColor = new BABYLON.Color3(0.03, 0.03, 0.035);
      toyWhiteMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);

      const toyBlackMat = new BABYLON.StandardMaterial('toyBlackMat', scene);
      toyBlackMat.diffuseColor = new BABYLON.Color3(0.10, 0.10, 0.12);
      toyBlackMat.emissiveColor = new BABYLON.Color3(0.01, 0.01, 0.012);
      toyBlackMat.specularColor = new BABYLON.Color3(0.01, 0.01, 0.01);


      // Knife materials (more realistic)
      const knifeBladeMat = new BABYLON.StandardMaterial('knifeBladeMat', scene);
      knifeBladeMat.diffuseColor = new BABYLON.Color3(0.80, 0.82, 0.86);
      knifeBladeMat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.025);
      knifeBladeMat.specularColor = new BABYLON.Color3(0.85, 0.85, 0.90);
      knifeBladeMat.specularPower = 96;

      const knifeHandleMat = new BABYLON.StandardMaterial('knifeHandleMat', scene);
      knifeHandleMat.diffuseColor = new BABYLON.Color3(0.10, 0.10, 0.11);
      knifeHandleMat.emissiveColor = new BABYLON.Color3(0.01, 0.01, 0.012);
      knifeHandleMat.specularColor = new BABYLON.Color3(0.08, 0.08, 0.09);
      knifeHandleMat.specularPower = 24;

      const knifeAccentMat = new BABYLON.StandardMaterial('knifeAccentMat', scene);
      knifeAccentMat.diffuseColor = new BABYLON.Color3(0.22, 0.22, 0.24);
      knifeAccentMat.emissiveColor = new BABYLON.Color3(0.01, 0.01, 0.012);
      knifeAccentMat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.28);
      knifeAccentMat.specularPower = 48;

      // Fart gun skin ("minion" vibe): bright yellow + green accents
      const fartBodyMat = new BABYLON.StandardMaterial('fartBodyMat', scene);
      fartBodyMat.diffuseColor = new BABYLON.Color3(1.00, 0.85, 0.18);
      fartBodyMat.emissiveColor = new BABYLON.Color3(0.06, 0.05, 0.01);
      fartBodyMat.specularColor = new BABYLON.Color3(0.30, 0.28, 0.18);
      fartBodyMat.specularPower = 48;

      const fartAccentMat = new BABYLON.StandardMaterial('fartAccentMat', scene);
      fartAccentMat.diffuseColor = new BABYLON.Color3(0.20, 0.85, 0.35);
      fartAccentMat.emissiveColor = new BABYLON.Color3(0.02, 0.08, 0.03);
      fartAccentMat.specularColor = new BABYLON.Color3(0.20, 0.25, 0.20);
      fartAccentMat.specularPower = 32;

      function makeGunVariant(kind) {
        const g = new BABYLON.TransformNode(`gun_${kind}`, scene);
        g.parent = gunRoot;

        const isFart = (kind === 'fart');
        const bodyM = isFart ? fartBodyMat : gunMat;
        const accM = isFart ? fartAccentMat : accentMat;
        const gripM = isFart ? fartAccentMat : gripMat;


        // SPECIAL: knife/grenades replace the gun entirely in-hand.
        // Also swap to cartoon colors so each weapon reads differently.
        const toy = {
          // Keep the "toy" look for the more arcade-y weapons.
          // Rifle + shotgun are now CS-ish realistic, so they are NOT in this list.
          sniper: { body: toyPurpleMat, acc: toyWhiteMat, grip: toyBlackMat },
          rocket: { body: toyGreenMat, acc: toyWhiteMat, grip: toyBlackMat },
          // minigun uses realistic mats (not toy colors)
        };

        // If this is a toy-gun weapon, override base mats.
        if (toy[kind]) {
          // eslint-disable-next-line no-unused-vars
          const _t = toy[kind];
        }

        // NOTE: bodyM/accM/gripM are const above; so we compute local overrides.
        const body = toy[kind]?.body || bodyM;
        const acc = toy[kind]?.acc || accM;
        const gripMatLocal = toy[kind]?.grip || gripM;

        if (kind === 'knife') {
          // CS-ish knife: longer blade, clear guard, black handle, metallic shine.
          // Built from simple primitives (no assets).

          // Handle
          const handle = BABYLON.MeshBuilder.CreateBox(`k_h_${kind}`, { width:0.06, height:0.06, depth:0.18 }, scene);
          handle.material = knifeHandleMat;
          handle.parent = g;
          handle.position.set(0.05, -0.06, 0.04);

          // Grip ridges
          for (let i = 0; i < 4; i++) {
            const ridge = BABYLON.MeshBuilder.CreateBox(`k_r_${kind}_${i}`, { width:0.062, height:0.008, depth:0.02 }, scene);
            ridge.material = knifeAccentMat;
            ridge.parent = g;
            ridge.position.set(0.05, -0.035, 0.01 + i * 0.04);
          }

          // Pommel
          const pommel = BABYLON.MeshBuilder.CreateCylinder(`k_p_${kind}`, { diameter: 0.045, height: 0.018, tessellation: 12 }, scene);
          pommel.material = knifeAccentMat;
          pommel.parent = g;
          pommel.rotation.x = Math.PI / 2;
          pommel.position.set(0.05, -0.06, -0.06);

          // Guard
          const guard = BABYLON.MeshBuilder.CreateBox(`k_g_${kind}`, { width:0.12, height:0.02, depth:0.04 }, scene);
          guard.material = knifeAccentMat;
          guard.parent = g;
          guard.position.set(0.05, -0.04, 0.14);

          // Blade: slight taper using 3 segments
          const b1 = BABYLON.MeshBuilder.CreateBox(`k_b1_${kind}`, { width:0.020, height:0.055, depth:0.18 }, scene);
          b1.material = knifeBladeMat;
          b1.parent = g;
          b1.position.set(0.05, -0.01, 0.28);

          const b2 = BABYLON.MeshBuilder.CreateBox(`k_b2_${kind}`, { width:0.018, height:0.050, depth:0.18 }, scene);
          b2.material = knifeBladeMat;
          b2.parent = g;
          b2.position.set(0.05, 0.00, 0.44);

          const b3 = BABYLON.MeshBuilder.CreateBox(`k_b3_${kind}`, { width:0.014, height:0.040, depth:0.16 }, scene);
          b3.material = knifeBladeMat;
          b3.parent = g;
          b3.position.set(0.05, 0.01, 0.59);

          // Spine ridge
          const spine = BABYLON.MeshBuilder.CreateBox(`k_sp_${kind}`, { width:0.010, height:0.018, depth:0.50 }, scene);
          spine.material = knifeAccentMat;
          spine.parent = g;
          spine.position.set(0.05, 0.03, 0.42);

          // Tip
          const tip = BABYLON.MeshBuilder.CreateCylinder(`k_t_${kind}`, { height:0.10, diameterTop:0.001, diameterBottom:0.030, tessellation: 12 }, scene);
          tip.material = knifeBladeMat;
          tip.parent = g;
          tip.rotation.x = Math.PI / 2;
          tip.position.set(0.05, 0.01, 0.72);

          // Base pose: right-side CS feel
          g.rotation.x = -0.10;
          g.rotation.z = -0.22;
          g.position.x += 0.08;
          g.position.y -= 0.04;
          g.position.z -= 0.03;

          // stab animation hook
          g.metadata = g.metadata || {};
          g.metadata._stab = 0;

          return g;
        }

        if (kind === 'grenade_frag' || kind === 'grenade_impact') {
          // Cartoon grenade: make it BIG + close so it never "disappears" on iPhone.
          const isImpact = (kind === 'grenade_impact');

          const bodyMesh = isImpact
            ? BABYLON.MeshBuilder.CreateCylinder(`g_c_${kind}`, { diameter: 0.24, height: 0.30, tessellation: 12 }, scene)
            : BABYLON.MeshBuilder.CreateSphere(`g_s_${kind}`, { diameter: 0.26, segments: 12 }, scene);
          bodyMesh.material = isImpact ? toyOrangeMat : toyGreenMat;
          bodyMesh.parent = g;
          bodyMesh.rotation.x = Math.PI / 2;
          bodyMesh.position.set(0.05, -0.07, 0.34);

          const band = BABYLON.MeshBuilder.CreateBox(`g_band_${kind}`, { width:0.24, height:0.06, depth:0.08 }, scene);
          band.material = toyWhiteMat;
          band.parent = g;
          band.position.set(0.05, 0.01, 0.34);

          const pin = BABYLON.MeshBuilder.CreateTorus(`g_pin_${kind}`, { diameter: 0.095, thickness: 0.014, tessellation: 14 }, scene);
          pin.material = toyYellowMat;
          pin.parent = g;
          pin.rotation.y = Math.PI / 2;
          pin.position.set(0.14, 0.05, 0.28);

          const lever = BABYLON.MeshBuilder.CreateBox(`g_lev_${kind}`, { width:0.022, height:0.10, depth:0.18 }, scene);
          lever.material = toyBlackMat;
          lever.parent = g;
          lever.position.set(0.03, 0.05, 0.34);
          lever.rotation.x = 0.22;

          // Held low and short in hand.
          g.rotation.x = -0.06;
          g.rotation.z = 0.14;

          return g;
        }

        // Receiver
        const receiver = BABYLON.MeshBuilder.CreateBox(`recv_${kind}`, { width:0.10, height:0.09, depth:0.22 }, scene);
        receiver.material = acc;
        receiver.parent = g;
        receiver.position.set(0.02, 0.00, 0.02);

        // Barrel (varies)
        const barrelLen = (kind === 'sniper') ? 0.98 : (kind === 'shotgun' ? 0.50 : 0.56);
        const barrelDia = (kind === 'shotgun') ? 0.065 : (kind === 'sniper' ? 0.04 : 0.045);
        const barrel = BABYLON.MeshBuilder.CreateCylinder(`bar_${kind}`, { diameter:barrelDia, height:barrelLen, tessellation: 10 }, scene);
        barrel.material = body;
        barrel.parent = g;
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(0.02, 0.00, 0.24 + barrelLen / 2);

        // Stock
        const stock = BABYLON.MeshBuilder.CreateBox(`stk_${kind}`, { width:0.09, height:0.08, depth:0.16 }, scene);
        stock.material = acc;
        stock.parent = g;
        stock.position.set(0.02, -0.01, -0.16);

        // Grip
        const grip = BABYLON.MeshBuilder.CreateBox(`gr_${kind}`, { width:0.05, height:0.10, depth:0.06 }, scene);
        grip.material = gripMatLocal;
        grip.parent = g;
        grip.position.set(0.05, -0.08, 0.02);
        grip.rotation.x = 0.25;

        // Sniper: CS-style realistic rifle (large scope, long barrel, picatinny mount, bolt, bipod)
        if (kind === 'sniper') {
          // Dark steel material for sniper-specific parts
          const sniperDarkMat = new BABYLON.StandardMaterial(`sniperDark_${kind}`, scene);
          sniperDarkMat.diffuseColor = new BABYLON.Color3(0.06, 0.06, 0.07);
          sniperDarkMat.emissiveColor = new BABYLON.Color3(0.005, 0.005, 0.006);
          sniperDarkMat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.18);
          sniperDarkMat.specularPower = 80;

          // Matte stock material (polymer look)
          const sniperStockMat = new BABYLON.StandardMaterial(`sniperStock_${kind}`, scene);
          sniperStockMat.diffuseColor = new BABYLON.Color3(0.04, 0.04, 0.045);
          sniperStockMat.emissiveColor = new BABYLON.Color3(0.002, 0.002, 0.002);
          sniperStockMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
          sniperStockMat.specularPower = 8;

          // Scope body (large, realistic tube)
          const scope = BABYLON.MeshBuilder.CreateCylinder(`sc_${kind}`, { diameter:0.10, height:0.42, tessellation: 16 }, scene);
          scope.material = sniperDarkMat;
          scope.parent = g;
          scope.rotation.x = Math.PI / 2;
          scope.position.set(0.02, 0.095, 0.38);

          // Scope front bell (flared objective lens)
          const scopeFront = BABYLON.MeshBuilder.CreateCylinder(`scf_${kind}`, {
            diameterTop: 0.13, diameterBottom: 0.10, height: 0.07, tessellation: 16
          }, scene);
          scopeFront.material = sniperDarkMat;
          scopeFront.parent = g;
          scopeFront.rotation.x = Math.PI / 2;
          scopeFront.position.set(0.02, 0.095, 0.62);

          // Scope front lens (blue tint)
          const scopeLens = BABYLON.MeshBuilder.CreateCylinder(`scl_${kind}`, { diameter: 0.11, height: 0.008, tessellation: 16 }, scene);
          const lensMat = new BABYLON.StandardMaterial(`scopeLensMat_${kind}`, scene);
          lensMat.diffuseColor = new BABYLON.Color3(0.04, 0.05, 0.08);
          lensMat.emissiveColor = new BABYLON.Color3(0.01, 0.012, 0.025);
          lensMat.specularColor = new BABYLON.Color3(0.25, 0.28, 0.35);
          lensMat.specularPower = 100;
          lensMat.alpha = 0.55;
          scopeLens.material = lensMat;
          scopeLens.parent = g;
          scopeLens.rotation.x = Math.PI / 2;
          scopeLens.position.set(0.02, 0.095, 0.655);

          // Scope rear eyepiece (smaller)
          const scopeRear = BABYLON.MeshBuilder.CreateCylinder(`scr_${kind}`, { diameter:0.08, height:0.06, tessellation: 16 }, scene);
          scopeRear.material = sniperDarkMat;
          scopeRear.parent = g;
          scopeRear.rotation.x = Math.PI / 2;
          scopeRear.position.set(0.02, 0.095, 0.14);

          // Scope adjustment turrets (elevation + windage knobs)
          const turretTop = BABYLON.MeshBuilder.CreateCylinder(`sct_${kind}`, { diameter:0.035, height:0.04, tessellation: 10 }, scene);
          turretTop.material = knifeBladeMat;
          turretTop.parent = g;
          turretTop.position.set(0.02, 0.15, 0.38);

          const turretSide = BABYLON.MeshBuilder.CreateCylinder(`scs_${kind}`, { diameter:0.03, height:0.035, tessellation: 10 }, scene);
          turretSide.material = knifeBladeMat;
          turretSide.parent = g;
          turretSide.rotation.z = Math.PI / 2;
          turretSide.position.set(0.07, 0.095, 0.38);

          // Picatinny rail / scope mount (two rings + rail)
          const rail = BABYLON.MeshBuilder.CreateBox(`scr2_${kind}`, { width:0.06, height:0.02, depth:0.30 }, scene);
          rail.material = sniperDarkMat;
          rail.parent = g;
          rail.position.set(0.02, 0.055, 0.38);

          const ring1 = BABYLON.MeshBuilder.CreateTorus(`sr1_${kind}`, { diameter:0.11, thickness:0.015, tessellation: 16 }, scene);
          ring1.material = sniperDarkMat;
          ring1.parent = g;
          ring1.rotation.x = Math.PI / 2;
          ring1.position.set(0.02, 0.095, 0.26);

          const ring2 = BABYLON.MeshBuilder.CreateTorus(`sr2_${kind}`, { diameter:0.11, thickness:0.015, tessellation: 16 }, scene);
          ring2.material = sniperDarkMat;
          ring2.parent = g;
          ring2.rotation.x = Math.PI / 2;
          ring2.position.set(0.02, 0.095, 0.50);

          // Bolt handle (longer, angled)
          const bolt = BABYLON.MeshBuilder.CreateCylinder(`bl_${kind}`, { diameter:0.016, height:0.12, tessellation: 10 }, scene);
          bolt.material = knifeBladeMat;
          bolt.parent = g;
          bolt.rotation.z = Math.PI / 2;
          bolt.position.set(0.10, 0.005, 0.12);

          const boltKnob = BABYLON.MeshBuilder.CreateSphere(`blk_${kind}`, { diameter:0.032, segments: 10 }, scene);
          boltKnob.material = knifeBladeMat;
          boltKnob.parent = g;
          boltKnob.position.set(0.16, 0.005, 0.12);

          // Bolt root (where it meets receiver)
          const boltRoot = BABYLON.MeshBuilder.CreateBox(`blr_${kind}`, { width:0.03, height:0.025, depth:0.06 }, scene);
          boltRoot.material = sniperDarkMat;
          boltRoot.parent = g;
          boltRoot.position.set(0.06, 0.005, 0.12);

          // Bipod (folding-style, two legs with feet)
          const bipodMount = BABYLON.MeshBuilder.CreateBox(`bpm_${kind}`, { width:0.04, height:0.02, depth:0.04 }, scene);
          bipodMount.material = sniperDarkMat;
          bipodMount.parent = g;
          bipodMount.position.set(0.02, -0.06, 0.68);

          const leg1 = BABYLON.MeshBuilder.CreateCylinder(`bp1_${kind}`, { diameter:0.014, height:0.24, tessellation: 10 }, scene);
          leg1.material = sniperDarkMat;
          leg1.parent = g;
          leg1.rotation.z = 0.50;
          leg1.position.set(-0.04, -0.14, 0.68);

          const leg2 = BABYLON.MeshBuilder.CreateCylinder(`bp2_${kind}`, { diameter:0.014, height:0.24, tessellation: 10 }, scene);
          leg2.material = sniperDarkMat;
          leg2.parent = g;
          leg2.rotation.z = -0.50;
          leg2.position.set(0.08, -0.14, 0.68);

          // Bipod feet (rubber tips)
          const foot1 = BABYLON.MeshBuilder.CreateSphere(`bpf1_${kind}`, { diameter:0.025, segments: 8 }, scene);
          foot1.material = sniperStockMat;
          foot1.parent = g;
          foot1.position.set(-0.09, -0.24, 0.68);

          const foot2 = BABYLON.MeshBuilder.CreateSphere(`bpf2_${kind}`, { diameter:0.025, segments: 8 }, scene);
          foot2.material = sniperStockMat;
          foot2.parent = g;
          foot2.position.set(0.13, -0.24, 0.68);

          // Longer barrel stretch + heavy barrel profile
          try {
            barrel.scaling.z = 1.45;
            barrel.scaling.x = 1.1;
            barrel.scaling.y = 1.1;
          } catch {}

          // Muzzle brake (slotted tip)
          const muzzleBrake = BABYLON.MeshBuilder.CreateCylinder(`mb_${kind}`, { diameter:0.055, height:0.08, tessellation: 12 }, scene);
          muzzleBrake.material = sniperDarkMat;
          muzzleBrake.parent = g;
          muzzleBrake.rotation.x = Math.PI / 2;
          muzzleBrake.position.set(0.02, 0.00, 0.24 + barrelLen * 1.45 / 2 + barrelLen * 1.45 / 2 + 0.04);

          // Cheek riser on stock
          const cheekRiser = BABYLON.MeshBuilder.CreateBox(`cr_${kind}`, { width:0.07, height:0.03, depth:0.10 }, scene);
          cheekRiser.material = sniperStockMat;
          cheekRiser.parent = g;
          cheekRiser.position.set(0.02, 0.03, -0.14);

          // Fancy "skin" pass (keep realistic tactical parts but add a premium skin on receiver)
          receiver.material = skinSniperMat;
          barrel.material = sniperDarkMat;
          stock.material = sniperStockMat;
          grip.material = sniperStockMat;
        }

        // Rifle: AK-style silhouette (wood furniture + curved mag)
        if (kind === 'rifle') {
          const akMetalMat = new BABYLON.StandardMaterial(`akMetal_${kind}`, scene);
          akMetalMat.diffuseColor = new BABYLON.Color3(0.10, 0.11, 0.13);
          akMetalMat.emissiveColor = new BABYLON.Color3(0.006, 0.006, 0.007);
          akMetalMat.specularColor = new BABYLON.Color3(0.20, 0.20, 0.22);
          akMetalMat.specularPower = 84;

          // Curved magazine (3-step curve)
          const mag1 = BABYLON.MeshBuilder.CreateBox(`mag1_${kind}`, { width:0.060, height:0.10, depth:0.060 }, scene);
          mag1.material = akMetalMat;
          mag1.parent = g;
          mag1.position.set(0.03, -0.10, 0.06);
          mag1.rotation.x = 0.15;

          const mag2 = BABYLON.MeshBuilder.CreateBox(`mag2_${kind}`, { width:0.060, height:0.10, depth:0.060 }, scene);
          mag2.material = akMetalMat;
          mag2.parent = g;
          mag2.position.set(0.03, -0.16, 0.11);
          mag2.rotation.x = 0.32;

          const mag3 = BABYLON.MeshBuilder.CreateBox(`mag3_${kind}`, { width:0.060, height:0.10, depth:0.060 }, scene);
          mag3.material = akMetalMat;
          mag3.parent = g;
          mag3.position.set(0.03, -0.22, 0.18);
          mag3.rotation.x = 0.52;

          // Wooden handguard
          const handguard = BABYLON.MeshBuilder.CreateBox(`ak_hg_${kind}`, { width:0.10, height:0.07, depth:0.22 }, scene);
          handguard.material = woodMat;
          handguard.parent = g;
          handguard.position.set(0.02, -0.02, 0.36);

          // Gas tube above barrel
          const gas = BABYLON.MeshBuilder.CreateCylinder(`ak_gas_${kind}`, { diameter:0.028, height:0.30, tessellation: 10 }, scene);
          gas.material = akMetalMat;
          gas.parent = g;
          gas.rotation.x = Math.PI / 2;
          gas.position.set(0.02, 0.045, 0.40);

          // Front sight block
          const fsb = BABYLON.MeshBuilder.CreateBox(`ak_fsb_${kind}`, { width:0.05, height:0.06, depth:0.05 }, scene);
          fsb.material = akMetalMat;
          fsb.parent = g;
          fsb.position.set(0.02, 0.02, 0.55);

          const post = BABYLON.MeshBuilder.CreateBox(`ak_post_${kind}`, { width:0.01, height:0.04, depth:0.01 }, scene);
          post.material = knifeBladeMat;
          post.parent = g;
          post.position.set(0.02, 0.05, 0.56);

          // Rear sight block
          const rs = BABYLON.MeshBuilder.CreateBox(`ak_rs_${kind}`, { width:0.05, height:0.03, depth:0.05 }, scene);
          rs.material = akMetalMat;
          rs.parent = g;
          rs.position.set(0.02, 0.03, 0.02);

          // Muzzle device
          const md = BABYLON.MeshBuilder.CreateCylinder(`ak_md_${kind}`, { diameter:0.050, height:0.06, tessellation: 12 }, scene);
          md.material = akMetalMat;
          md.parent = g;
          md.rotation.x = Math.PI / 2;
          md.position.set(0.02, 0.00, 0.24 + barrelLen / 2 + 0.04);

          // Wooden stock (chunkier, AK-ish)
          stock.scaling.x = 1.25;
          stock.scaling.y = 1.10;
          stock.scaling.z = 1.15;
          stock.position.z = -0.18;
          stock.position.y = -0.01;
          stock.material = woodMat;

          // Apply materials
          receiver.material = akMetalMat;
          barrel.material = akMetalMat;
          grip.material = akMetalMat;
        }

        // Shotgun: more realistic pump shotgun (tube mag, bead sight, darker mats)
        if (kind === 'shotgun') {
          const sgDarkMat = new BABYLON.StandardMaterial(`sgDark_${kind}`, scene);
          sgDarkMat.diffuseColor = new BABYLON.Color3(0.07, 0.07, 0.08);
          sgDarkMat.emissiveColor = new BABYLON.Color3(0.004, 0.004, 0.004);
          sgDarkMat.specularColor = new BABYLON.Color3(0.10, 0.10, 0.12);
          sgDarkMat.specularPower = 56;

          const sgPolyMat = new BABYLON.StandardMaterial(`sgPoly_${kind}`, scene);
          sgPolyMat.diffuseColor = new BABYLON.Color3(0.045, 0.045, 0.05);
          sgPolyMat.emissiveColor = new BABYLON.Color3(0.002, 0.002, 0.002);
          sgPolyMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
          sgPolyMat.specularPower = 10;

          // Pump / fore-end
          const pump = BABYLON.MeshBuilder.CreateBox(`pm_${kind}`, { width:0.105, height:0.065, depth:0.16 }, scene);
          pump.material = sgPolyMat;
          pump.parent = g;
          pump.position.set(0.02, -0.03, 0.33);

          // Tube magazine under barrel
          const tube = BABYLON.MeshBuilder.CreateCylinder(`sgTube_${kind}`, { diameter:0.040, height: barrelLen * 0.90, tessellation: 12 }, scene);
          tube.material = sgDarkMat;
          tube.parent = g;
          tube.rotation.x = Math.PI / 2;
          tube.position.set(0.02, -0.055, 0.26 + (barrelLen * 0.90) / 2);

          // Bead sight
          const bead = BABYLON.MeshBuilder.CreateSphere(`sgBead_${kind}`, { diameter:0.016, segments: 8 }, scene);
          bead.material = knifeBladeMat;
          bead.parent = g;
          bead.position.set(0.02, 0.03, 0.24 + barrelLen / 2 + 0.02);

          // Slightly chunkier stock
          try {
            stock.scaling.x = 1.05;
            stock.scaling.y = 1.10;
          } catch {}

          // Fancy "skin" pass
          receiver.material = skinShotgunMat;
          barrel.material = sgDarkMat;
          stock.material = sgPolyMat;
          grip.material = sgPolyMat;
        }

        // Rocket launcher extras: big tube + fins + rear cap so it's unmistakable
        if (kind === 'rocket') {
          // Main tube
          const tube = BABYLON.MeshBuilder.CreateCylinder(`rk_tube_${kind}`, { diameter: 0.18, height: 0.82, tessellation: 14 }, scene);
          tube.material = acc;
          tube.parent = g;
          tube.rotation.x = Math.PI / 2;
          tube.position.set(0.02, 0.06, 0.40);

          // Front tip (tapered)
          const tip = BABYLON.MeshBuilder.CreateCylinder(
            `rk_tip_${kind}`,
            { height: 0.18, diameterTop: 0.001, diameterBottom: 0.16, tessellation: 14 },
            scene
          );
          tip.material = body;
          tip.parent = g;
          tip.rotation.x = Math.PI / 2;
          tip.position.set(0.02, 0.06, 0.86);

          // Rear cap
          const cap = BABYLON.MeshBuilder.CreateCylinder(`rk_cap_${kind}`, { diameter: 0.19, height: 0.06, tessellation: 14 }, scene);
          cap.material = body;
          cap.parent = g;
          cap.rotation.x = Math.PI / 2;
          cap.position.set(0.02, 0.06, -0.02);

          // Fins (4)
          for (let i = 0; i < 4; i++) {
            const fin = BABYLON.MeshBuilder.CreateBox(`rk_fin_${kind}_${i}`, { width: 0.03, height: 0.09, depth: 0.14 }, scene);
            fin.material = acc;
            fin.parent = g;
            fin.position.set(0.02, 0.06, 0.70);
            fin.rotation.z = (Math.PI / 2) * i;
            fin.position.x += Math.cos(fin.rotation.z) * 0.10;
            fin.position.y += Math.sin(fin.rotation.z) * 0.10;
          }

          // Simple sight block on top
          const sight = BABYLON.MeshBuilder.CreateBox(`rk_sight_${kind}`, { width: 0.08, height: 0.05, depth: 0.10 }, scene);
          sight.material = body;
          sight.parent = g;
          sight.position.set(0.02, 0.14, 0.28);
        }

        // Fart gun extras: a "tank" + nozzle so it's obvious.
        if (kind === 'fart') {
          const tank = BABYLON.MeshBuilder.CreateCylinder(`tk_${kind}`, { diameter: 0.14, height: 0.20, tessellation: 12 }, scene);
          tank.material = acc;
          tank.parent = g;
          tank.rotation.x = Math.PI / 2;
          tank.position.set(-0.06, 0.02, -0.02);

          const nozzle = BABYLON.MeshBuilder.CreateCylinder(`nz_${kind}`, { diameter: 0.09, height: 0.16, tessellation: 12 }, scene);
          nozzle.material = acc;
          nozzle.parent = g;
          nozzle.rotation.x = Math.PI / 2;
          nozzle.position.set(0.02, 0.02, 0.62);
        }

        // MINIGUN — M134-style Gatling cannon, unmistakable in hand.
        // Completely replaces the base geometry. Wide, heavy, glowing barrel tips.
        if (kind === 'minigun') {
          // Hide base rifle parts — tag so setGun re-enable cascade skips them.
          [receiver, barrel, stock, grip].forEach(m => {
            m.setEnabled(false);
            m.metadata = Object.assign(m.metadata || {}, { _intentionallyHidden: true });
          });

          // ── Materials ────────────────────────────────────────────────────────
          const mBlack = new BABYLON.StandardMaterial(`mg_blk_${kind}`, scene);
          mBlack.diffuseColor = new BABYLON.Color3(0.07, 0.07, 0.08);
          mBlack.specularColor = new BABYLON.Color3(0.25, 0.25, 0.28);
          mBlack.specularPower = 55;

          const mOrange = new BABYLON.StandardMaterial(`mg_org_${kind}`, scene);
          mOrange.diffuseColor = new BABYLON.Color3(1.0, 0.42, 0.0);
          mOrange.emissiveColor = new BABYLON.Color3(0.22, 0.07, 0.0);

          const mChrome = new BABYLON.StandardMaterial(`mg_chr_${kind}`, scene);
          mChrome.diffuseColor = new BABYLON.Color3(0.72, 0.76, 0.80);
          mChrome.specularColor = new BABYLON.Color3(0.85, 0.85, 0.85);
          mChrome.specularPower = 120;

          const mGlow = new BABYLON.StandardMaterial(`mg_glow_${kind}`, scene); // glowing barrel tips
          mGlow.diffuseColor = new BABYLON.Color3(1.0, 0.78, 0.2);
          mGlow.emissiveColor = new BABYLON.Color3(0.55, 0.30, 0.0);
          mGlow.disableLighting = false;

          const mYellow = new BABYLON.StandardMaterial(`mg_yel_${kind}`, scene);
          mYellow.diffuseColor = new BABYLON.Color3(0.88, 0.74, 0.08);
          mYellow.emissiveColor = new BABYLON.Color3(0.10, 0.08, 0.0);

          // ── Body block (wide, chunky — nothing like a rifle) ─────────────────
          const body = BABYLON.MeshBuilder.CreateBox(`mg_body_${kind}`, { width: 0.24, height: 0.19, depth: 0.32 }, scene);
          body.material = mBlack; body.parent = g; body.position.set(0, 0, -0.04);

          // Top rail / handle mount (orange)
          const rail = BABYLON.MeshBuilder.CreateBox(`mg_rail_${kind}`, { width: 0.20, height: 0.022, depth: 0.28 }, scene);
          rail.material = mOrange; rail.parent = g; rail.position.set(0, 0.112, -0.04);

          // Carrying handle arch
          const hArch = BABYLON.MeshBuilder.CreateBox(`mg_ha_${kind}`, { width: 0.024, height: 0.072, depth: 0.08 }, scene);
          hArch.material = mBlack; hArch.parent = g; hArch.position.set(0, 0.16, -0.04);
          const hTop = BABYLON.MeshBuilder.CreateBox(`mg_ht_${kind}`, { width: 0.14, height: 0.022, depth: 0.08 }, scene);
          hTop.material = mBlack; hTop.parent = g; hTop.position.set(0, 0.20, -0.04);

          // ── Huge barrel shroud cylinder ───────────────────────────────────────
          const shroud = BABYLON.MeshBuilder.CreateCylinder(`mg_sh_${kind}`, { diameter: 0.30, height: 0.56, tessellation: 18 }, scene);
          shroud.material = mBlack; shroud.parent = g;
          shroud.rotation.x = Math.PI / 2; shroud.position.set(0, 0, 0.38);

          // Orange warning rings around shroud (3 rings — iconic look)
          [0.15, 0.30, 0.52].forEach((z, i) => {
            const ring = BABYLON.MeshBuilder.CreateTorus(`mg_ring_${kind}_${i}`, { diameter: 0.30, thickness: 0.020, tessellation: 18 }, scene);
            ring.material = mOrange; ring.parent = g;
            ring.rotation.x = Math.PI / 2; ring.position.set(0, 0, z);
          });

          // Muzzle face — big flat chrome disc
          const mFace = BABYLON.MeshBuilder.CreateCylinder(`mg_mf_${kind}`, { diameter: 0.32, height: 0.035, tessellation: 18 }, scene);
          mFace.material = mChrome; mFace.parent = g;
          mFace.rotation.x = Math.PI / 2; mFace.position.set(0, 0, 0.68);

          // ── 6-barrel cluster (visible through shroud openings) ────────────────
          const hubCyl = BABYLON.MeshBuilder.CreateCylinder(`mg_hub_${kind}`, { diameter: 0.12, height: 0.54, tessellation: 12 }, scene);
          hubCyl.material = mChrome; hubCyl.parent = g;
          hubCyl.rotation.x = Math.PI / 2; hubCyl.position.set(0, 0, 0.38);

          const barrels = [];
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const bx = Math.cos(a) * 0.105;
            const by = Math.sin(a) * 0.105;

            // Barrel tube
            const b = BABYLON.MeshBuilder.CreateCylinder(`mg_br_${kind}_${i}`, { diameter: 0.040, height: 0.62, tessellation: 8 }, scene);
            b.material = mChrome; b.parent = g;
            b.rotation.x = Math.PI / 2; b.position.set(bx, by, 0.38);

            // Glowing muzzle tip per barrel (hot orange glow)
            const tip = BABYLON.MeshBuilder.CreateCylinder(`mg_tip_${kind}_${i}`, { diameter: 0.042, height: 0.045, tessellation: 8 }, scene);
            tip.material = mGlow; tip.parent = g;
            tip.rotation.x = Math.PI / 2; tip.position.set(bx, by, 0.685);

            barrels.push(b);
          }

          // ── Pistol grip ───────────────────────────────────────────────────────
          const pGrip = BABYLON.MeshBuilder.CreateBox(`mg_grip_${kind}`, { width: 0.075, height: 0.18, depth: 0.085 }, scene);
          pGrip.material = mBlack; pGrip.parent = g;
          pGrip.rotation.x = 0.20; pGrip.position.set(0, -0.19, 0.02);

          // ── Ammo box (bright yellow, big, on the left) ───────────────────────
          const aBox = BABYLON.MeshBuilder.CreateBox(`mg_abox_${kind}`, { width: 0.20, height: 0.20, depth: 0.26 }, scene);
          aBox.material = mYellow; aBox.parent = g; aBox.position.set(-0.25, 0, -0.02);

          const aLid = BABYLON.MeshBuilder.CreateBox(`mg_alid_${kind}`, { width: 0.202, height: 0.025, depth: 0.262 }, scene);
          aLid.material = mOrange; aLid.parent = g; aLid.position.set(-0.25, 0.115, -0.02);

          // Belt links from box to gun
          for (let i = 0; i < 7; i++) {
            const lnk = BABYLON.MeshBuilder.CreateBox(`mg_lnk_${kind}_${i}`, { width: 0.022, height: 0.018, depth: 0.032 }, scene);
            lnk.material = mYellow; lnk.parent = g;
            lnk.position.set(-0.14 + i * 0.024, 0.0, -0.02 + i * 0.016);
            lnk.rotation.y = 0.14;
          }

          // ── Spin animation hook ───────────────────────────────────────────────
          g.metadata = g.metadata || {};
          g.metadata._minigunBarrels = barrels;
        }

        return g;
      }

      const guns = {
        rifle: makeGunVariant('rifle'),
        shotgun: makeGunVariant('shotgun'),
        sniper: makeGunVariant('sniper'),
        rocket: makeGunVariant('rocket'),
        fart: makeGunVariant('fart'),
        minigun: makeGunVariant('minigun'),
        knife: makeGunVariant('knife'),
        grenade_frag: makeGunVariant('grenade_frag'),
        grenade_impact: makeGunVariant('grenade_impact'),
      };

      function setGun(kind) {
        const k = (kind === 'shotgun' || kind === 'sniper' || kind === 'fart' || kind === 'rocket' || kind === 'minigun' || kind === 'knife' || kind === 'grenade_frag' || kind === 'grenade_impact') ? kind : 'rifle';
        for (const [name, node] of Object.entries(guns)) {
          const show = (name === k);
          // IMPORTANT: do NOT disable gun root nodes. Disabling a parent can make descendants
          // non-renderable regardless of isVisible, and re-enabling doesn't reliably restore.
          // Keep everything enabled; toggle visibility only.
          try { node.setEnabled(true); } catch {}

          node.getDescendants(false).forEach(d => {
            if (typeof d.isVisible === 'undefined') return;
            if (show && d.metadata && d.metadata._intentionallyHidden) return; // keep hidden
            try { d.isVisible = show; } catch {}
          });
        }
      }
      // Default
      setGun('rifle');

      // Slight tilt so it feels more like aiming forward
      root.rotation.x = 0.01;
      root.rotation.y = 0.0;

      // Muzzle flash (hidden most of the time)
      const flashMat = new BABYLON.StandardMaterial('flashMat', scene);
      flashMat.emissiveColor = new BABYLON.Color3(1.0, 0.92, 0.35);
      flashMat.diffuseColor = new BABYLON.Color3(0,0,0);
      flashMat.alpha = 1.0;

      const muzzleFlash = BABYLON.MeshBuilder.CreatePlane('muzzleFlash', { size:0.18 }, scene);
      muzzleFlash.material = flashMat;
      muzzleFlash.parent = gunRoot;
      muzzleFlash.position.set(0.02, 0.00, 0.56);
      muzzleFlash.rotation.y = Math.PI; // face camera
      muzzleFlash.isVisible = false;

      fpRig = { root, lFore, leftHand, rFore, rightHand, gunRoot, muzzleFlash, setGun, guns, _flashBaseSize: 0.18 };
      // Keep gun in sync with weapon selection.
      try { fpRig.setGun(document.getElementById('weapon')?.value); } catch {}
      return fpRig;
    }

    const blockMat = new BABYLON.StandardMaterial('bm', scene);
    // Walls/obstacles: concrete wall vibe
    blockMat.diffuseColor = new BABYLON.Color3(0.62, 0.64, 0.68);
    blockMat.emissiveColor = new BABYLON.Color3(0.04, 0.04, 0.04);

    function addBlock(x,y,z,w=2,h=2,d=2) {
      const b = BABYLON.MeshBuilder.CreateBox('b', { width:w, height:h, depth:d }, scene);
      b.position.set(x, y + h/2, z);
      b.material = blockMat;
      b.isPickable = true;
      return b;
    }

    const MAP_OBSTACLES = {
      arena: [
        { x: 0, y: 0, z: 0, w: 3, h: 3, d: 3 },
        { x: -8, y: 0, z: 6, w: 4, h: 2, d: 6 },
        { x: 10, y: 0, z: -6, w: 6, h: 3, d: 3 },
      ],
      mansion: [
        // Keep visuals aligned with server.js "mansion" obstacle layout.
        // This avoids "invisible wall" or "phantom cover" confusion.

        // Perimeter + main gate gap (north)
        { x: -14.5, y: 0, z: -23, w: 19, h: 4.6, d: 2 },
        { x: 14.5, y: 0, z: -23, w: 19, h: 4.6, d: 2 },
        { x: -23, y: 0, z: 0, w: 2, h: 4.6, d: 46 },
        { x: 23, y: 0, z: 0, w: 2, h: 4.6, d: 46 },
        { x: 0, y: 0, z: 23, w: 46, h: 4.6, d: 2 },

        // Drained pool (two low rims)
        { x: -11, y: 0, z: -14, w: 1.0, h: 1.15, d: 9.0 },
        { x: -5, y: 0, z: -14, w: 1.0, h: 1.15, d: 9.0 },

        // Courtyard micro-cover: breaks the longest gate→door sightline (helps attackers cross).
        { x: 0.0, y: 0, z: -12.0, w: 3.0, h: 1.15, d: 1.0 },
        // Extra offset cover on courtyard-left: gives a second crossing option without adding clutter.
        { x: -6.0, y: 0, z: -12.0, w: 2.4, h: 1.15, d: 1.0 },

        // Mansion facade + door choke
        { x: -9.5, y: 0, z: -6, w: 11, h: 4.6, d: 2 },
        { x: 9.5, y: 0, z: -6, w: 11, h: 4.6, d: 2 },
        { x: -1.7, y: 0, z: -6, w: 1.2, h: 4.6, d: 2.2 },
        { x: 1.7, y: 0, z: -6, w: 1.2, h: 4.6, d: 2.2 },

        // Interior: back wall
        { x: 0, y: 0, z: 10.5, w: 22, h: 4.6, d: 2 },

        // Jump-up props (low cover + movement options)
        { x: -2.0, y: 0, z: -18.0, w: 2.4, h: 1.15, d: 2.4 },
        { x: 2.0, y: 0, z: -18.0, w: 2.4, h: 1.15, d: 2.4 },
        { x: -8.0, y: 0, z: -11.0, w: 2.2, h: 1.15, d: 2.2 },
        // Nudge away from the facade wall at z=-6 to avoid overlapping collision/visual clutter.
        { x: 2.0, y: 0, z: -9.0, w: 2.2, h: 1.15, d: 2.2 },

        // Courtyard-right "sniper tower" (climb via jump-steps)
        { x: 17.6, y: 0, z: -17.0, w: 2.6, h: 0.95, d: 2.6 },
        { x: 18.6, y: 0, z: -15.6, w: 2.2, h: 1.20, d: 2.2 },
        { x: 19.2, y: 0, z: -13.6, w: 3.2, h: 1.55, d: 3.2 },
        { x: 21.1, y: 0, z: -13.6, w: 1.0, h: 3.6, d: 4.6 },
        { x: 19.2, y: 0, z: -11.6, w: 2.2, h: 1.0, d: 0.9 },
      ],
    };
    const mapBlocks = [];
    function applyMapVisual(mapId) {
      const list = MAP_OBSTACLES[mapId] || MAP_OBSTACLES.arena;
      while (mapBlocks.length) {
        try { mapBlocks.pop().dispose(); } catch {}
      }
      for (const o of list) {
        mapBlocks.push(addBlock(o.x, o.y, o.z, o.w, o.h, o.d));
      }
      try { window.__hbCurrentMapVisual = mapId || 'arena'; } catch {}
    }
    try { window.__hbApplyMapVisual = applyMapVisual; } catch {}
    applyMapVisual('arena');

    // Aim reticle
    const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('ui2');
    const ret = new BABYLON.GUI.Ellipse();
    ret.width = '10px';
    ret.height = '10px';
    ret.thickness = 2;
    ret.color = 'rgba(255,255,255,0.65)';
    ret.background = 'transparent';
    advancedTexture.addControl(ret);

    // Scope overlay (sniper)
    const scope = new BABYLON.GUI.Ellipse();
    scope.width = '82%';
    scope.height = '82%';
    scope.thickness = 4;
    scope.color = 'rgba(0,0,0,0.65)';
    scope.background = 'transparent';
    scope.isVisible = false;
    advancedTexture.addControl(scope);

    const scopeLines = new BABYLON.GUI.TextBlock();
    scopeLines.text = '+';
    scopeLines.color = 'rgba(255,255,255,0.65)';
    scopeLines.fontSize = 44;
    scopeLines.isVisible = false;
    advancedTexture.addControl(scopeLines);

    function updateScopeUI() {
      try {
        const weaponSel = document.getElementById('weapon')?.value;
        const scoped = (weaponSel === 'sniper') && (state.scope === true);
        const targetFov = scoped ? SCOPE_FOV : DEFAULT_FOV;

        // Smooth FOV transition (~150ms)
        const SCOPE_LERP_MS = 150;
        if (typeof updateScopeUI._fovTarget !== 'number' || updateScopeUI._fovTarget !== targetFov) {
          updateScopeUI._fovFrom = camera.fov;
          updateScopeUI._fovTarget = targetFov;
          updateScopeUI._fovStart = performance.now();
        }
        const t = performance.now();
        const k = Math.min(1, (t - (updateScopeUI._fovStart || t)) / SCOPE_LERP_MS);
        camera.fov = (updateScopeUI._fovFrom ?? camera.fov) + (updateScopeUI._fovTarget - (updateScopeUI._fovFrom ?? camera.fov)) * k;
        if (k < 1) requestAnimationFrame(updateScopeUI);

        scope.isVisible = scoped;
        scopeLines.isVisible = scoped;
        ret.isVisible = !scoped;

        // HUD hint: when compact HUD is active, show scoped state on the weapon chip.
        try {
          if (weaponSel === 'sniper') {
            const chip = document.getElementById('weaponChip');
            if (chip) chip.textContent = `🔫 Sniper${scoped ? ' 🎯' : ''}`;
          }
        } catch {}

        // Rocket launcher: bigger reticle (big splash)
        if (!scoped) {
          if (weaponSel === 'rocket') {
            ret.width = '18px';
            ret.height = '18px';
            ret.thickness = 3;
          } else {
            ret.width = '10px';
            ret.height = '10px';
            ret.thickness = 2;
          }
        }

        const scopeBtn = document.getElementById('btnScope');
        if (scopeBtn) {
          scopeBtn.style.display = (weaponSel === 'sniper') ? 'flex' : 'none';
          // scoped glow
          if (scoped) {
            scopeBtn.style.boxShadow = '0 0 0 2px rgba(124,92,255,0.35), 0 0 22px rgba(124,92,255,0.35)';
            scopeBtn.style.borderColor = 'rgba(124,92,255,0.65)';
            scopeBtn.style.background = 'rgba(124,92,255,0.18)';
          } else {
            scopeBtn.style.boxShadow = 'none';
            scopeBtn.style.borderColor = 'rgba(255,255,255,0.35)';
            scopeBtn.style.background = 'rgba(0,0,0,0.18)';
          }
        }
      } catch {}
    }

    function flashReticle(kind) {
      const orig = ret.color;
      if (kind === 'hit') ret.color = 'rgba(255,80,80,0.95)';
      else ret.color = 'rgba(255,240,120,0.95)';
      setTimeout(() => { ret.color = orig; }, 80);
    }



    // ── Combat feel: hitmarker, recoil, screen-shake ──
    const _hitmarkerEl = document.getElementById('hitmarker');
    let _hitmarkerTimer = 0;
    function showHitmarker() {
      if (!_hitmarkerEl) return;
      clearTimeout(_hitmarkerTimer);
      _hitmarkerEl.style.opacity = '1';
      _hitmarkerEl.style.transform = 'translate(-50%,-50%) scale(1.3)';
      requestAnimationFrame(() => {
        _hitmarkerEl.style.transition = 'opacity 100ms ease-out, transform 100ms ease-out';
        _hitmarkerEl.style.opacity = '0';
        _hitmarkerEl.style.transform = 'translate(-50%,-50%) scale(0.7)';
      });
      _hitmarkerTimer = setTimeout(() => {
        _hitmarkerEl.style.transition = 'none';
      }, 120);
    }

    const RECOIL = {
      rifle:   { gunKick: 0.04, pitchKick: 0.018, shakeAmt: 0.003, flashScale: 1.0 },
      shotgun: { gunKick: 0.08, pitchKick: 0.035, shakeAmt: 0.008, flashScale: 1.6 },
      sniper:  { gunKick: 0.10, pitchKick: 0.045, shakeAmt: 0.005, flashScale: 1.3 },
      fart:    { gunKick: 0.02, pitchKick: 0.005, shakeAmt: 0.001, flashScale: 0.6 },
      minigun: { gunKick: 0.025, pitchKick: 0.008, shakeAmt: 0.005, flashScale: 1.8 },
    };

    let _shakePitch = 0;
    let _shakeYaw = 0;
    const SHAKE_DECAY = 0.82;

    function applyRecoil(weapon) {
      const r = RECOIL[weapon] || RECOIL.rifle;
      if (fpRig?.gunRoot) fpRig.gunRoot.position.z -= r.gunKick;
      // Screen shake disabled (too nauseating on mobile).
      // _shakePitch += r.pitchKick * (0.8 + Math.random() * 0.4);
      // _shakeYaw   += (Math.random() - 0.5) * r.shakeAmt * 2;
    }
    // Sound FX (procedural WebAudio; no external files)
    const SFX = (() => {
      let ctx = null;
      let unlockPromise = null;
      let unlocked = false;

      function ensure() {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        return ctx;
      }

      function unlockIfNeeded() {
        const c = ensure();
        if (c.state !== 'suspended') { unlocked = true; return Promise.resolve(); }
        if (!unlockPromise) {
          unlockPromise = c.resume().catch(()=>{}).finally(() => { unlockPromise = null; unlocked = (c.state !== 'suspended'); });
        }
        return unlockPromise;
      }

      function play(fn) {
        const c = ensure();
        if (c.state === 'suspended') {
          // iOS will sometimes suspend audio again; resume, then play.
          unlockIfNeeded().then(() => {
            if (c.state === 'suspended') {
              try { log('Audio locked (tap screen once)'); } catch {}
              return;
            }
            try { fn(c); } catch {}
          });
          return;
        }
        unlocked = true;
        try { fn(c); } catch {}
      }

      // Proactively unlock audio on the first real gesture.
      // (Otherwise iOS will drop some early/occasional SFX.)
      window.addEventListener('pointerdown', () => { unlockIfNeeded(); }, { passive: true });
      window.addEventListener('touchstart', () => { unlockIfNeeded(); }, { passive: true });

      function primeAudioOnReturn() {
        try {
          const c = ensure();
          // iOS often suspends audio when app backgrounds.
          if (c.state === 'suspended') {
            try { c.resume(); } catch {}
          }
          // Play a near-silent buffer to re-prime routing.
          try {
            const b = c.createBuffer(1, 1, c.sampleRate);
            const src = c.createBufferSource();
            src.buffer = b;
            const g = c.createGain();
            g.gain.value = 0.00001;
            src.connect(g).connect(c.destination);
            const t0 = (c.currentTime || 0) + 0.005;
            src.start(t0);
            src.stop(t0 + 0.01);
          } catch {}
        } catch {}
      }


      function noiseBuffer(c, seconds = 0.15) {
        const len = Math.floor(c.sampleRate * seconds);
        const buf = c.createBuffer(1, len, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);
        return buf;
      }

      function gunshot(weapon = 'rifle') {
        play((c) => {
          const t0 = c.currentTime + 0.001;

          const w = String(weapon || 'rifle');
          const cfg = (w === 'shotgun')
            ? {
                noise: 0.18,
                bpFreq: 900,
                bpQ: 0.7,
                lpFreq: 2600,
                gainPeak: 0.38,
                gainMid: 0.06,
                gainMidAt: 0.09,
                gainEndAt: 0.22,
                thumpType: 'sine',
                thumpStart: 120,
                thumpEnd: 70,
                thumpPeak: 0.16,
                thumpEndAt: 0.16,
              }
            : (w === 'sniper')
            ? {
                noise: 0.14,
                bpFreq: 1600,
                bpQ: 1.1,
                lpFreq: 5200,
                gainPeak: 0.30,
                gainMid: 0.03,
                gainMidAt: 0.05,
                gainEndAt: 0.18,
                thumpType: 'triangle',
                thumpStart: 220,
                thumpEnd: 110,
                thumpPeak: 0.12,
                thumpEndAt: 0.13,
                // small "tail" click to feel snappier
                clickHz: 3200,
                clickMs: 18,
                clickGain: 0.015,
              }
            : (w === 'fart')
            ? {
                noise: 0.22,
                bpFreq: 280,
                bpQ: 0.6,
                lpFreq: 900,
                gainPeak: 0.20,
                gainMid: 0.05,
                gainMidAt: 0.12,
                gainEndAt: 0.28,
                thumpType: 'sine',
                thumpStart: 90,
                thumpEnd: 55,
                thumpPeak: 0.10,
                thumpEndAt: 0.20,
              }
            : (w === 'minigun')
            ? {
                // minigun: tighter, punchier "brrrt" (less thump, more mid)
                noise: 0.09,
                bpFreq: 1500,
                bpQ: 1.0,
                lpFreq: 4600,
                gainPeak: 0.18,
                gainMid: 0.03,
                gainMidAt: 0.05,
                gainEndAt: 0.11,
                thumpType: 'triangle',
                thumpStart: 140,
                thumpEnd: 95,
                thumpPeak: 0.06,
                thumpEndAt: 0.10,
              }
            : {
                // rifle default
                noise: 0.11,
                bpFreq: 1300,
                bpQ: 0.9,
                lpFreq: 3800,
                gainPeak: 0.24,
                gainMid: 0.02,
                gainMidAt: 0.06,
                gainEndAt: 0.14,
                thumpType: 'triangle',
                thumpStart: 170,
                thumpEnd: 95,
                thumpPeak: 0.10,
                thumpEndAt: 0.11,
              };

          // Noise burst
          const src = c.createBufferSource();
          src.buffer = noiseBuffer(c, cfg.noise);

          // Shape it: bandpass + slight distortion + fast decay
          const bp = c.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.setValueAtTime(cfg.bpFreq, t0);
          bp.Q.setValueAtTime(cfg.bpQ, t0);

          const lp = c.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(cfg.lpFreq, t0);

          const shaper = c.createWaveShaper();
          const curve = new Float32Array(256);
          for (let i = 0; i < curve.length; i++) {
            const x = (i / (curve.length - 1)) * 2 - 1;
            curve[i] = Math.tanh(2.0 * x);
          }
          shaper.curve = curve;

          const g = c.createGain();
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(cfg.gainPeak, t0 + 0.003);
          g.gain.exponentialRampToValueAtTime(cfg.gainMid, t0 + cfg.gainMidAt);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + cfg.gainEndAt);

          // Low "thump"
          const o = c.createOscillator();
          o.type = cfg.thumpType;
          o.frequency.setValueAtTime(cfg.thumpStart, t0);
          o.frequency.exponentialRampToValueAtTime(cfg.thumpEnd, t0 + 0.09);
          const og = c.createGain();
          og.gain.setValueAtTime(0.0001, t0);
          og.gain.exponentialRampToValueAtTime(cfg.thumpPeak, t0 + 0.004);
          og.gain.exponentialRampToValueAtTime(0.0001, t0 + cfg.thumpEndAt);

          const mix = c.createGain();
          mix.gain.value = 0.78;

          src.connect(bp).connect(shaper).connect(lp).connect(g).connect(mix);
          o.connect(og).connect(mix);

          // Optional click (sniper)
          let clickOsc = null;
          if (cfg.clickHz) {
            clickOsc = c.createOscillator();
            clickOsc.type = 'square';
            clickOsc.frequency.value = cfg.clickHz;
            const cg = c.createGain();
            cg.gain.value = cfg.clickGain || 0.01;
            clickOsc.connect(cg).connect(mix);
            clickOsc.start(t0);
            clickOsc.stop(t0 + (cfg.clickMs || 12) / 1000);
          }

          mix.connect(c.destination);

          src.start(t0);
          src.stop(t0 + cfg.gainEndAt);
          o.start(t0);
          o.stop(t0 + cfg.thumpEndAt);
        });
      }

      function tick(freq, durMs, gainVal) {
        play((c) => {
          const o = c.createOscillator();
          const g = c.createGain();
          o.type = 'square';
          o.frequency.value = freq;
          g.gain.value = gainVal;
          o.connect(g).connect(c.destination);
          o.start();
          setTimeout(() => { try { o.stop(); } catch {} }, durMs);
        });
      }

      function fart() {
        // A silly "pbbbt" using filtered noise + a low wobble tone.
        play((c) => {
          const t0 = c.currentTime + 0.001;

          const src = c.createBufferSource();
          src.buffer = noiseBuffer(c, 0.28);

          const lp = c.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.setValueAtTime(420, t0);
          lp.frequency.exponentialRampToValueAtTime(220, t0 + 0.25);

          const wob = c.createOscillator();
          wob.type = 'sine';
          wob.frequency.setValueAtTime(70, t0);
          wob.frequency.exponentialRampToValueAtTime(45, t0 + 0.22);

          const wg = c.createGain();
          wg.gain.setValueAtTime(0.0001, t0);
          wg.gain.exponentialRampToValueAtTime(0.10, t0 + 0.01);
          wg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);

          const g = c.createGain();
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.01);
          g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.12);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);

          src.connect(lp).connect(g).connect(c.destination);
          wob.connect(wg).connect(c.destination);

          src.start(t0);
          src.stop(t0 + 0.28);
          wob.start(t0);
          wob.stop(t0 + 0.26);
        });
      }

      return {
        enable: () => {
          // IMPORTANT: keep this synchronous with the user gesture on iOS.
          // Kick resume immediately, then try to play a near-silent buffer to fully unlock routing.
          try { unlockIfNeeded(); } catch {}
          try {
            const c = ensure();
            // If still suspended, attempt resume again (gesture).
            if (c.state === 'suspended') { try { c.resume(); } catch {} }

            const b = c.createBuffer(1, 1, c.sampleRate);
            const src = c.createBufferSource();
            src.buffer = b;
            const g = c.createGain();
            g.gain.value = 0.00001;
            src.connect(g).connect(c.destination);
            // schedule slightly in the future to avoid "cannot start" edge cases
            const t0 = (c.currentTime || 0) + 0.005;
            src.start(t0);
            src.stop(t0 + 0.01);
          } catch {}
        },
        shoot: (weapon) => {
          if (!unlocked) { try { log('Tap Enable sound'); } catch {} }
          if (String(weapon) === 'fart') return fart();
          return gunshot(weapon);
        },
        hit: () => tick(760, 60, 0.02),
        kill: () => tick(320, 120, 0.02),
        reload: () => tick(520, 90, 0.015),
        lowhp: () => tick(210, 140, 0.018),
        whoosh: () => (function(){
          play((c)=>{
            const t0=c.currentTime+0.001;

            // Low thump
            const o=c.createOscillator();
            const g=c.createGain();
            o.type='sine';
            o.frequency.setValueAtTime(130,t0);
            o.frequency.exponentialRampToValueAtTime(65,t0+0.20);
            g.gain.setValueAtTime(0.0001,t0);
            g.gain.exponentialRampToValueAtTime(0.18,t0+0.01);
            g.gain.exponentialRampToValueAtTime(0.0001,t0+0.26);
            o.connect(g).connect(c.destination);
            o.start(t0);
            o.stop(t0+0.28);

            // Air whoosh (noise)
            const n=c.createBufferSource();
            n.buffer=noiseBuffer(c,0.14);
            const bp=c.createBiquadFilter();
            bp.type='bandpass';
            bp.frequency.setValueAtTime(650,t0);
            bp.Q.setValueAtTime(0.9,t0);
            const ng=c.createGain();
            ng.gain.setValueAtTime(0.0001,t0);
            ng.gain.exponentialRampToValueAtTime(0.14,t0+0.01);
            ng.gain.exponentialRampToValueAtTime(0.0001,t0+0.16);
            n.connect(bp).connect(ng).connect(c.destination);
            n.start(t0);
            n.stop(t0+0.16);
          });
        })(),
        boom: () => (function(){
          play((c)=>{
            const t0=c.currentTime+0.001;
            const o=c.createOscillator();
            const g=c.createGain();
            o.type='sine';
            o.frequency.setValueAtTime(120,t0);
            o.frequency.exponentialRampToValueAtTime(45,t0+0.28);
            g.gain.setValueAtTime(0.0001,t0);
            g.gain.exponentialRampToValueAtTime(0.22,t0+0.01);
            g.gain.exponentialRampToValueAtTime(0.0001,t0+0.36);
            o.connect(g).connect(c.destination);
            o.start(t0);
            o.stop(t0+0.38);

            const n=c.createBufferSource();
            n.buffer=noiseBuffer(c,0.20);
            const lp=c.createBiquadFilter();
            lp.type='lowpass';
            lp.frequency.setValueAtTime(800,t0);
            const ng=c.createGain();
            ng.gain.setValueAtTime(0.0001,t0);
            ng.gain.exponentialRampToValueAtTime(0.18,t0+0.01);
            ng.gain.exponentialRampToValueAtTime(0.0001,t0+0.30);
            n.connect(lp).connect(ng).connect(c.destination);
            n.start(t0);
            n.stop(t0+0.30);
          });
        })(),
        fart,
        prime: () => { try { primeAudioOnReturn(); } catch {} },
      };
    })();

    // iOS background/foreground: audio context may get suspended; re-prime on return.
    const _primeAudio = () => {
      try { SFX.prime && SFX.prime(); } catch {}
    };
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) _primeAudio();
    }, { passive: true });
    window.addEventListener('pageshow', () => { _primeAudio(); }, { passive: true });
    window.addEventListener('focus', () => { _primeAudio(); }, { passive: true });





    function onDamageMsg(msg) {
      try {
        if (String(msg.to) !== String(state.me)) return;
        const el = document.getElementById('dmgVignette');
        if (el) {
          el.style.opacity = '1';
          clearTimeout(onDamageMsg._t);
          onDamageMsg._t = setTimeout(()=>{ try { el.style.opacity = '0'; } catch {} }, 160);
        }
        const d = document.createElement('div');
        d.textContent = `-${Math.round(msg.amount||0)}`;
        d.style.position = 'fixed';
        d.style.left = '50%';
        d.style.top = '46%';
        d.style.transform = 'translate(-50%, -50%)';
        d.style.fontWeight = '900';
        d.style.fontSize = '16px';
        d.style.color = 'rgba(255,90,90,0.95)';
        d.style.textShadow = '0 2px 10px rgba(0,0,0,0.55)';
        d.style.zIndex = '97';
        d.style.pointerEvents = 'none';
        document.body.appendChild(d);
        const trailPuffs = [];
        const start = performance.now();
        const dur = 340;
        let lastPuffAt = 0;
        const tick = () => {
          const t = performance.now()-start;
          const k = Math.min(1, t/dur);
          d.style.opacity = String(1-k);
          d.style.transform = `translate(-50%, ${-50 - k*18}%)`;
          if (k<1) requestAnimationFrame(tick);
          else { try { d.remove(); } catch {} }
        };
        requestAnimationFrame(tick);
      } catch {}
    }

function showWinner(msg) {
      try {
        const el = document.getElementById('winnerBanner');
        if (!el) return;
        el.textContent = `WINNER: ${msg.winnerName || msg.winnerId}`;
        el.style.opacity = '1';
        clearTimeout(showWinner._t);
        showWinner._t = setTimeout(() => { try { el.style.opacity = '0'; } catch {} }, 3000);
      } catch {}
    }

    function spawnFartPuff(targetId) {
      try {
        const root = players.get(String(targetId));
        if (!root) return;
        const base = root.position.clone();
        base.y += 2.05;
        const meshes = [];
        for (let i = 0; i < 5; i++) {
          const m = BABYLON.MeshBuilder.CreateSphere(`puff_${targetId}_${Date.now()}_${i}`, { diameter: 0.18, segments: 6 }, scene);
          m.position = base.add(new BABYLON.Vector3((Math.random()-0.5)*0.28, (Math.random()-0.5)*0.18, (Math.random()-0.5)*0.28));
          m.isPickable = false;
          const mat = new BABYLON.StandardMaterial(`puffm_${targetId}_${Date.now()}_${i}`, scene);
          mat.diffuseColor = new BABYLON.Color3(0.25, 0.95, 0.35);
          mat.emissiveColor = new BABYLON.Color3(0.05, 0.18, 0.07);
          mat.alpha = 0.75;
          mat.disableLighting = true;
          m.material = mat;
          meshes.push({ m, mat });
        }
        const start = performance.now();
        const dur = 330;
        const tick = () => {
          const t = performance.now() - start;
          const k = Math.min(1, t / dur);
          for (const it of meshes) {
            try {
              it.m.scaling.setAll(1 + k * 1.6);
              it.mat.alpha = 0.75 * (1 - k);
            } catch {}
          }
          if (k < 1) requestAnimationFrame(tick);
          else {
            for (const it of meshes) { try { it.m.dispose(); } catch {} }
          }
        };
        requestAnimationFrame(tick);
      } catch {}
    }

    function spawnFartDot(targetId, dmg) {
      try {
        const root = players.get(String(targetId));
        if (!root) return;
        const plane = BABYLON.MeshBuilder.CreatePlane(`dot_${targetId}_${Date.now()}`, { width: 0.55, height: 0.25 }, scene);
        plane.position = root.position.clone();
        plane.position.y += 2.35;
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        plane.isPickable = false;

        const dt = new BABYLON.DynamicTexture(`dot_dt_${targetId}_${Date.now()}`, { width: 256, height: 128 }, scene, true);
        dt.hasAlpha = true;
        const ctx = dt.getContext();
        ctx.clearRect(0, 0, 256, 128);
        ctx.fillStyle = 'rgba(0,0,0,0.0)';
        ctx.fillRect(0, 0, 256, 128);
        ctx.font = '900 72px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial';
        ctx.fillStyle = 'rgba(120,255,160,0.95)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`-${dmg || 5}`, 128, 70);
        dt.update();

        const mat = new BABYLON.StandardMaterial(`dot_mat_${targetId}_${Date.now()}`, scene);
        mat.diffuseTexture = dt;
        mat.opacityTexture = dt;
        mat.emissiveColor = new BABYLON.Color3(1,1,1);
        mat.disableLighting = true;
        plane.material = mat;

        const start = performance.now();
        const dur = 300;
        const y0 = plane.position.y;
        const tick = () => {
          const t = performance.now() - start;
          const k = Math.min(1, t / dur);
          try {
            plane.position.y = y0 + k * 0.35;
            mat.alpha = 1 - k;
          } catch {}
          if (k < 1) requestAnimationFrame(tick);
          else { try { plane.dispose(); dt.dispose(); } catch {} }
        };
        requestAnimationFrame(tick);
      } catch {}
    }


    function renderRocketProjectile(from, to) {
      try {
        const dir = to.subtract(from);
        const dist = dir.length();
        if (dist < 0.01) return;

        const fwd = dir.normalize();

        // Rocket body
        const rocket = BABYLON.MeshBuilder.CreateCylinder(
          `rk_${Date.now()}`,
          { height: 0.44, diameterTop: 0.07, diameterBottom: 0.11, tessellation: 10 },
          scene
        );
        rocket.isPickable = false;

        const mat = new BABYLON.StandardMaterial(`rkm_${Date.now()}`, scene);
        mat.diffuseColor = new BABYLON.Color3(0.68, 0.68, 0.72);
        mat.emissiveColor = new BABYLON.Color3(0.10, 0.10, 0.12);
        mat.specularColor = new BABYLON.Color3(0.12, 0.12, 0.12);
        rocket.material = mat;

        // Cylinder points up (Y). Rotate so Y aligns to forward.
        const up = new BABYLON.Vector3(0, 1, 0);
        // Robust orientation without relying on RotationAlignToRef (not present in all Babylon builds).
        try {
          const a = new BABYLON.Vector3(0, 1, 0);
          const b = fwd;
          const dot = BABYLON.Vector3.Dot(a, b);
          if (dot < -0.999999) {
            rocket.rotationQuaternion = BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(1,0,0), Math.PI);
          } else if (dot > 0.999999) {
            rocket.rotationQuaternion = BABYLON.Quaternion.Identity();
          } else {
            const axis = BABYLON.Vector3.Cross(a, b);
            const s = Math.sqrt((1 + dot) * 2);
            const invs = 1 / s;
            rocket.rotationQuaternion = new BABYLON.Quaternion(axis.x * invs, axis.y * invs, axis.z * invs, s * 0.5);
          }
        } catch {}

        // Flame
        const flame = BABYLON.MeshBuilder.CreateSphere(`rkf_${Date.now()}`, { diameter: 0.11, segments: 6 }, scene);
        flame.isPickable = false;
        const fmat = new BABYLON.StandardMaterial(`rkfm_${Date.now()}`, scene);
        fmat.diffuseColor = new BABYLON.Color3(1.0, 0.62, 0.12);
        fmat.emissiveColor = new BABYLON.Color3(1.0, 0.40, 0.08);
        fmat.alpha = 0.9;
        fmat.disableLighting = true;
        flame.material = fmat;

        const trailPuffs = [];
        const start = performance.now();
        const dur = 340;
        let lastPuffAt = 0;
        const tick = () => {
          const t = performance.now() - start;
          const k = Math.min(1, t / dur);
          const p = from.add(dir.scale(k));
          rocket.position.copyFrom(p);
          flame.position.copyFrom(p.add(fwd.scale(-0.20)));
          fmat.alpha = 0.9 * (1 - k * 0.25);

          // Smoke trail puffs
          if ((t - lastPuffAt) > 35) {
            lastPuffAt = t;
            try {
              const puff = BABYLON.MeshBuilder.CreateSphere(`rks_${Date.now()}`, { diameter: 0.16, segments: 6 }, scene);
              puff.isPickable = false;
              puff.position.copyFrom(p.add(fwd.scale(-0.35)).add(new BABYLON.Vector3((Math.random()-0.5)*0.10, (Math.random()-0.5)*0.06, (Math.random()-0.5)*0.10)));
              const sm = new BABYLON.StandardMaterial(`rksm_${Date.now()}`, scene);
              sm.diffuseColor = new BABYLON.Color3(0.22,0.22,0.24);
              sm.emissiveColor = new BABYLON.Color3(0.02,0.02,0.02);
              sm.alpha = 0.30;
              sm.disableLighting = true;
              puff.material = sm;
              trailPuffs.push({ puff, sm, born: performance.now() });
            } catch {}
          }
          for (const sp of trailPuffs) {
            const age = performance.now() - sp.born;
            const kk = Math.min(1, age / 260);
            try {
              sp.puff.scaling.setAll(1 + kk * 2.2);
              sp.sm.alpha = 0.30 * (1 - kk);
            } catch {}
          }

          if (k < 1) requestAnimationFrame(tick);
          else {
            try { rocket.dispose(); } catch {}
            try { flame.dispose(); } catch {}
            for (const sp of trailPuffs) { try { sp.puff.dispose(); } catch {} }
          }
        };
        requestAnimationFrame(tick);
      } catch {}
    }

    // Grenade client-side sim (visual only)
    const _grenades = new Map();
    function onGrenadeSpawn(msg) {
      try {
        if (!scene) return;
        const id = msg.id;
        // bright sphere so it's obvious on iPhone
        const ball = BABYLON.MeshBuilder.CreateSphere('g_'+id, { diameter: 0.28, segments: 12 }, scene);
        const mat = new BABYLON.StandardMaterial('gm_'+id, scene);
        const isImpact = String(msg.kind||'').includes('impact');
        mat.diffuseColor = isImpact ? new BABYLON.Color3(0.98, 0.55, 0.18) : new BABYLON.Color3(0.25, 0.92, 0.45);
        mat.emissiveColor = isImpact ? new BABYLON.Color3(0.14, 0.06, 0.02) : new BABYLON.Color3(0.03, 0.10, 0.05);
        mat.specularColor = new BABYLON.Color3(0.01,0.01,0.01);
        ball.material = mat;
        ball.position.set(msg.x, msg.y, msg.z);

        _grenades.set(id, {
          mesh: ball,
          vx: +msg.vx || 0,
          vy: +msg.vy || 0,
          vz: +msg.vz || 0,
          fuseAt: (typeof msg.fuseAt === 'number') ? msg.fuseAt : (Date.now() + 1200),
        });
      } catch {}
    }

    function onSlashMsg(msg) {
      // quick local feedback
      try { flashReticle('hit'); } catch {}
    }

function spawnExplosion(msg) {
      try {
        const x = +msg.x, y = +msg.y, z = +msg.z;
        const r = +msg.r || 6;

        // Visual: expanding fireball + flash + smoke
        const sphere = BABYLON.MeshBuilder.CreateSphere(`ex_${Date.now()}`, { diameter: 0.6, segments: 10 }, scene);

        const flash = BABYLON.MeshBuilder.CreateSphere(`exFlash_${Date.now()}`, { diameter: 0.35, segments: 8 }, scene);
        flash.position.set(x, y, z);
        flash.isPickable = false;
        const fmat = new BABYLON.StandardMaterial(`exFlashM_${Date.now()}`, scene);
        fmat.diffuseColor = new BABYLON.Color3(1,1,1);
        fmat.emissiveColor = new BABYLON.Color3(1,1,1);
        fmat.alpha = 0.9;
        fmat.disableLighting = true;
        flash.material = fmat;


        const ring = BABYLON.MeshBuilder.CreateTorus(`exr_${Date.now()}`, { diameter: 0.8, thickness: 0.05, tessellation: 28 }, scene);
        ring.position.set(x, y + 0.05, z);
        ring.rotation.x = Math.PI / 2;
        ring.isPickable = false;
        sphere.position.set(x, y, z);
        sphere.isPickable = false;

        const mat = new BABYLON.StandardMaterial(`exm_${Date.now()}`, scene);
        mat.diffuseColor = new BABYLON.Color3(1.0, 0.62, 0.12);
        mat.emissiveColor = new BABYLON.Color3(1.0, 0.45, 0.08);
        mat.alpha = 0.85;
        mat.disableLighting = true;
        sphere.material = mat;

        const streaks = [];

        const smokePuffs = [];
        for (let i = 0; i < 7; i++) {
          const puff = BABYLON.MeshBuilder.CreateSphere(`exs_${Date.now()}_${i}`, { diameter: 0.45, segments: 8 }, scene);
          puff.isPickable = false;
          puff.position.set(x + (Math.random()-0.5)*0.8, y + (Math.random()-0.5)*0.4, z + (Math.random()-0.5)*0.8);
          const sm = new BABYLON.StandardMaterial(`exsm_${Date.now()}_${i}`, scene);
          sm.diffuseColor = new BABYLON.Color3(0.20, 0.20, 0.22);
          sm.emissiveColor = new BABYLON.Color3(0.03, 0.03, 0.03);
          sm.alpha = 0.35;
          sm.disableLighting = true;
          puff.material = sm;
          smokePuffs.push({ puff, sm });
        }

        const rmat = new BABYLON.StandardMaterial(`exrm_${Date.now()}`, scene);
        rmat.diffuseColor = new BABYLON.Color3(1.0, 0.70, 0.20);
        rmat.emissiveColor = new BABYLON.Color3(1.0, 0.45, 0.08);
        rmat.alpha = 0.65;
        rmat.disableLighting = true;
        ring.material = rmat;
        for (let i = 0; i < 6; i++) {
          const ang = Math.random() * Math.PI * 2;
          const len = 0.7 + Math.random() * 1.0;
          const p1 = new BABYLON.Vector3(x, y, z);
          const p2 = new BABYLON.Vector3(x + Math.cos(ang) * len, y + (Math.random()-0.5)*0.4, z + Math.sin(ang) * len);
          const line = BABYLON.MeshBuilder.CreateLines(`exl_${Date.now()}_${i}`, { points: [p1, p2] }, scene);
          line.color = new BABYLON.Color3(1.0, 0.75, 0.20);
          line.alpha = 0.85;
          streaks.push(line);
        }

        // Sound
        try { SFX.boom(); } catch {}

        const start = performance.now();
        const dur = 420;
        const tick = () => {
          const t = performance.now() - start;
          const k = Math.min(1, t / dur);
          try {
            const scale = 1 + k * (r * 0.35);
            sphere.scaling.setAll(scale);
            try { ring.scaling.setAll(1 + k * (r * 0.22)); rmat.alpha = 0.65 * (1 - k); } catch {}
            mat.alpha = 0.85 * (1 - k);
            try { fmat.alpha = 0.9 * (1 - Math.min(1, k*3)); flash.scaling.setAll(1 + k*2.2); } catch {}
            for (const sp of smokePuffs) {
              try {
                sp.puff.scaling.setAll(1 + k * 2.4);
                sp.sm.alpha = 0.35 * (1 - k);
              } catch {}
            }
          } catch {}
          for (const line of streaks) {
            try { line.alpha = 0.85 * (1 - k); } catch {}
          }
          if (k < 1) requestAnimationFrame(tick);
          else {
            try { sphere.dispose(); } catch {}
            try { flash.dispose(); } catch {}
            try { ring.dispose(); } catch {}
            for (const line of streaks) { try { line.dispose(); } catch {} }
            for (const sp of smokePuffs) { try { sp.puff.dispose(); } catch {} }
          }
        };
        requestAnimationFrame(tick);
      } catch {}
    }



    function updateScoreboardModal(s) {
      try {
        const body = document.getElementById('scoreboardBody');
        if (!body) return;
        const meId = String(state.me || '');
        const rows = (s.players || []).slice().sort((a,b)=> (b.score||0)-(a.score||0));
        body.innerHTML = rows.map((p,i) => {
          const isMe = String(p.id) === meId;
          return `<div style="display:flex; justify-content:space-between; padding:8px 6px; border-radius:12px; ${isMe?'background: rgba(124,92,255,0.16); border:1px solid rgba(124,92,255,0.28);':'border:1px solid rgba(255,255,255,0.10);'} margin-bottom:8px;">
            <div><span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:${p.color};margin-right:8px;"></span><span style="font-weight:900;">${i+1}. ${p.name}${isMe?' (you)':''}</span></div>
            <div style="font-weight:900;">K ${p.score||0} <span style="opacity:.8;">D ${p.deaths||0}</span></div>
          </div>`;
        }).join('') || '<div style="opacity:.8;">No players.</div>';
      } catch {}
    }

function showKill(text) {
      // reuse hit toast area for now
      const d = document.getElementById('hitDetail');
      d.textContent = text;
      d.style.opacity = '1';
      clearTimeout(showKill._t);
      showKill._t = setTimeout(() => { d.style.opacity = '0'; }, 1200);
      SFX.kill();
    }

    function showHitToast(detail) {
      const el = document.getElementById('hitToast');
      const d = document.getElementById('hitDetail');
      el.style.opacity = '1';
      d.textContent = detail || '';
      d.style.opacity = detail ? '1' : '0';
      clearTimeout(showHitToast._t);
      showHitToast._t = setTimeout(() => { el.style.opacity = '0'; d.style.opacity = '0'; }, 260);
    }


    // Bullet dents (lightweight decals)
    const _dents = [];
    const MAX_DENTS = 300;


    // Impact flash: single billboard plane (no line-based spark rays).
    // At most ONE visible at a time to keep visuals clean during rapid fire.
    function spawnSparks(pos, intensity=1) {
      try {
        if (!scene || !pos) return;
        // Dispose previous flash to prevent accumulation
        if (window.__lastImpactFlash) {
          try { window.__lastImpactFlash.dispose(); } catch {}
          window.__lastImpactFlash = null;
        }

        const sz = 0.18 + 0.10 * intensity;
        const flash = BABYLON.MeshBuilder.CreatePlane('impFlash', { size: sz }, scene);
        flash.position = pos.clone();
        flash.position.y += 0.06;
        flash.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        flash.isPickable = false;

        const mat = new BABYLON.StandardMaterial('impFlashMat', scene);
        mat.diffuseColor  = new BABYLON.Color3(1.0, 0.88, 0.55);
        mat.emissiveColor = new BABYLON.Color3(1.0, 0.78, 0.35);
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        mat.alpha = 0.85;
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        flash.material = mat;

        window.__lastImpactFlash = flash;

        const start = performance.now();
        const dur = 90;
        const tick = () => {
          const t = performance.now() - start;
          const k = Math.min(1, t / dur);
          try {
            mat.alpha = 0.85 * (1 - k);
            flash.scaling.setAll(1.0 + k * 0.4);
          } catch {}
          if (k < 1) requestAnimationFrame(tick);
          else {
            try { flash.dispose(); } catch {}
            try { mat.dispose(); } catch {}
            if (window.__lastImpactFlash === flash) window.__lastImpactFlash = null;
          }
        };
        requestAnimationFrame(tick);
      } catch {}
    }


    function clearDents() {
      try {
        while (_dents.length) {
          try { _dents.pop().dispose(); } catch {}
        }
      } catch {}
    }

function spawnDent(pos, normal, size, kind) {
      try {
        if (!scene || !pos) return;
        // Keep dents slightly above surface to reduce z-fighting.
        const p = pos.clone();
        const n = (normal && normal.length && normal.length() > 0.1) ? normal.normalize() : new BABYLON.Vector3(0,1,0);
        p.addInPlace(n.scale(0.012));

        const dent = BABYLON.MeshBuilder.CreateCylinder(`dent_${Date.now()}`, {
          height: 0.01,
          diameter: size,
          tessellation: 14,
        }, scene);
        dent.isPickable = false;
        dent.position.copyFrom(p);

        // Align cylinder Y axis to normal
        try {
          const a = new BABYLON.Vector3(0, 1, 0);
          const b = n;
          const dot = BABYLON.Vector3.Dot(a, b);
          if (dot < -0.999999) {
            dent.rotationQuaternion = BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(1,0,0), Math.PI);
          } else if (dot > 0.999999) {
            dent.rotationQuaternion = BABYLON.Quaternion.Identity();
          } else {
            const axis = BABYLON.Vector3.Cross(a, b);
            const s = Math.sqrt((1 + dot) * 2);
            const invs = 1 / s;
            dent.rotationQuaternion = new BABYLON.Quaternion(axis.x * invs, axis.y * invs, axis.z * invs, s * 0.5);
          }
          // Random spin around normal so it doesn't look stamped
          const spin = BABYLON.Quaternion.RotationAxis(b, Math.random() * Math.PI * 2);
          dent.rotationQuaternion = spin.multiply(dent.rotationQuaternion);
        } catch {}

        // Orient dent to the surface normal (true 3D mark, not floating).
        dent.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
        dent.rotation.y = Math.random() * Math.PI * 2;

        const mat = new BABYLON.StandardMaterial(`dentm_${Date.now()}`, scene);
        if (kind === 'rocket') {
          mat.diffuseColor = new BABYLON.Color3(0.02, 0.02, 0.02);
          mat.emissiveColor = new BABYLON.Color3(0.02, 0.01, 0.00);
          mat.alpha = 0.78;
        } else {
          mat.diffuseColor = new BABYLON.Color3(0.04, 0.04, 0.04);
          mat.emissiveColor = new BABYLON.Color3(0.01, 0.01, 0.01);
          mat.alpha = 0.72;
        }
        mat.specularColor = new BABYLON.Color3(0,0,0);
        mat.disableLighting = true;
        dent.material = mat;

        // Rocket crater: add a larger faint scorch ring
        let craterRing = null;
        let rmat = null;
        if (kind === 'rocket') {
          craterRing = BABYLON.MeshBuilder.CreateTorus(`dent_ring_${Date.now()}`, { diameter: size * 1.35, thickness: Math.max(0.06, size * 0.10), tessellation: 28 }, scene);
          craterRing.isPickable = false;
          craterRing.position.copyFrom(p);
          craterRing.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
          try { craterRing.rotationQuaternion = dent.rotationQuaternion ? dent.rotationQuaternion.clone() : null; } catch {}
          rmat = new BABYLON.StandardMaterial(`dent_ringm_${Date.now()}`, scene);
          rmat.diffuseColor = new BABYLON.Color3(0.12, 0.08, 0.04);
          rmat.emissiveColor = new BABYLON.Color3(0.06, 0.03, 0.01);
          rmat.alpha = 0.55;
          rmat.disableLighting = true;
          craterRing.material = rmat;
          _dents.push(craterRing);
        }

        _dents.push(dent);
        while (_dents.length > MAX_DENTS) {
          try { _dents.shift().dispose(); } catch {}
        }
        // Permanent until round reset / page reload (capped by MAX_DENTS)
      } catch {}
    }

    function renderShot(s) {
      const color = s.hit ? new BABYLON.Color3(1.0, 0.35, 0.35) : new BABYLON.Color3(1.0, 0.9, 0.45);
      // Start tracer from gun muzzle (approx) instead of player center.
      // For first-person (you), use camera forward; for others, use yaw.
      const gunStart = (() => {
        const baseY = (s.sy || 1.8) - 0.15;
        if (s.from === myId && camera) {
          const fwd = camera.getDirection(BABYLON.Axis.Z);
          return new BABYLON.Vector3(
            camera.position.x + fwd.x * 0.65,
            camera.position.y - 0.25,
            camera.position.z + fwd.z * 0.65
          );
        }
        const yaw = (typeof s.yaw === 'number') ? s.yaw : 0;
        const dirX = Math.sin(yaw);
        const dirZ = Math.cos(yaw);
        return new BABYLON.Vector3((s.sx || 0) + dirX * 0.6, baseY, (s.sz || 0) + dirZ * 0.6);
      })();

      const segments = [];
      if (Array.isArray(s.traces) && s.traces.length) {
        const w = (s.weapon || 'rifle');
        // Visual policy: keep tracers clean/CS-style → 1 line per shot.
        // - shotgun: average pellets into one line
        // - everything else: first trace only
        if (w === 'shotgun') {
          let ax = 0, az = 0;
          for (const tr of s.traces) { ax += tr.ex; az += tr.ez; }
          ax /= s.traces.length; az /= s.traces.length;
          segments.push([gunStart, new BABYLON.Vector3(ax, (s.sy || 1.8) - 0.2, az)]);
        } else {
          const tr0 = s.traces[0];
          segments.push([gunStart, new BABYLON.Vector3(tr0.ex, (s.sy || 1.8) - 0.2, tr0.ez)]);
        }
      } else {
        segments.push([gunStart, new BABYLON.Vector3(s.ex, (s.sy || 1.8) - 0.2, s.ez)]);
      }
      const wpn0 = (s.weapon || 'rifle');
      const weaponNoTracer = (wpn0 === 'rocket' || wpn0.startsWith('grenade_') || wpn0 === 'knife');

      // Knife shots: no tracers/lines/sparks. (Swing animation is handled elsewhere.)
      const isKnife = (wpn0 === 'knife');

      // Use client-side picking so dents appear on ALL geometry (walls, blocks, floor, ceiling).
      function pickImpact(from, to) {
        try {
          const dir = to.subtract(from);
          const len = dir.length();
          if (len < 0.001) return to;
          const ray = new BABYLON.Ray(from, dir.normalize(), len);
          const hit = scene.pickWithRay(ray, (mesh) => {
            if (!mesh) return false;
            // ignore player meshes (they're stored in players map, plus names etc)
            if (mesh.name && (mesh.name.startsWith('p_') || mesh.name.includes('nameplate') || mesh.name.includes('shot'))) return false;
            return true;
          });
          if (hit && hit.hit && hit.pickedPoint) {
            let n = null;
            try { n = hit.getNormal(true); } catch {}
            return { p: hit.pickedPoint, n };
          }
        } catch {}
        return { p: to, n: null };
      }

      // Tracers / projectiles
      if (!weaponNoTracer) {
        // Hitscan tracer – strict single-line policy:
        // At most ONE visible tracer globally (not just per-weapon) so rapid fire
        // or fast weapon-switching never accumulates multiple lines.
        try {
          if (!window.__lastTracerByWeapon) window.__lastTracerByWeapon = {};
          // Dispose ALL active tracers (any weapon) before drawing new one
          for (const k of Object.keys(window.__lastTracerByWeapon)) {
            const prev = window.__lastTracerByWeapon[k];
            if (prev && !prev.isDisposed?.()) { try { prev.dispose(); } catch {} }
            delete window.__lastTracerByWeapon[k];
          }
        } catch {}

        const pts = segments[0];
        if (pts) {
          const lines = BABYLON.MeshBuilder.CreateLines('shot', { points: pts }, scene);
          lines.color = color;
          lines.alpha = 0.9;
          try {
            if (!window.__lastTracerByWeapon) window.__lastTracerByWeapon = {};
            window.__lastTracerByWeapon[wpn0] = lines;
          } catch {}

          const ttl = (wpn0 === 'rifle') ? 70 : (wpn0 === 'minigun') ? 55 : (wpn0 === 'shotgun') ? 140 : (wpn0 === 'sniper') ? 180 : 120;
          setTimeout(() => { try { lines.dispose(); } catch {} }, ttl);
        }
      } else if (wpn0.startsWith('grenade_')) {
        // Grenade throw arc (visual only): curved line, not hitscan.
        try {
          const yaw = (typeof s.yaw === 'number') ? s.yaw : 0;
          const pitch = (typeof s.pitch === 'number') ? s.pitch : 0;
          const dirX = Math.sin(yaw) * Math.cos(pitch);
          const dirY = Math.sin(pitch);
          const dirZ = Math.cos(yaw) * Math.cos(pitch);
          const speed = 16;
          const vx = dirX * speed;
          const vy0 = (dirY * speed) + 3.5;
          const vz = dirZ * speed;
          const grav = -18;

          const pts = [];
          const steps = 18;
          const totalT = 0.85;
          for (let i = 0; i <= steps; i++) {
            const tt = (i / steps) * totalT;
            const px = gunStart.x + vx * tt;
            const py = gunStart.y + vy0 * tt + 0.5 * grav * tt * tt;
            const pz = gunStart.z + vz * tt;
            pts.push(new BABYLON.Vector3(px, Math.max(1.82, py), pz));
          }

          const arc = BABYLON.MeshBuilder.CreateLines('gArc', { points: pts }, scene);
          arc.color = (wpn0 === 'grenade_impact') ? new BABYLON.Color3(1.0, 0.55, 0.18) : new BABYLON.Color3(0.25, 0.92, 0.45);
          arc.alpha = 0.95;
          setTimeout(() => { try { arc.dispose(); } catch {} }, 320);
        } catch {}
      } else if (wpn0 === 'knife') {
        // Knife: no tracer/lines. We'll animate the in-hand knife swing instead.
      }

      // Bullet marks disabled (no dents). Keep sparks for feedback.
      if (!s.hit) {
        try {
          const wpn = (s.weapon || 'rifle');
          if (Array.isArray(s.traces) && s.traces.length) {
            // Some weapons (rifle/shotgun) can arrive with multiple traces (pellets / server detail).
            // For cleaner CS-style visuals, only spawn ONE impact spark burst.
            const oneSpark = (wpn === 'rifle' || wpn === 'shotgun' || wpn === 'minigun');
            const list = oneSpark ? [s.traces[0]] : s.traces;
            for (const tr of list) {
              const raw = new BABYLON.Vector3(tr.ex, (s.ey || (s.sy || 1.8) - 0.2), tr.ez);
              const hit = pickImpact(gunStart, raw);
              if (wpn !== 'rocket' && !String(wpn).startsWith('grenade_') && wpn !== 'knife') spawnSparks(hit.p, wpn === 'shotgun' ? 0.8 : 1.0);
            }
          } else {
            const raw = new BABYLON.Vector3(s.ex, (s.ey || (s.sy || 1.8) - 0.2), s.ez);
            const hit = pickImpact(gunStart, raw);
            if (wpn !== 'rocket' && !String(wpn).startsWith('grenade_') && wpn !== 'knife') spawnSparks(hit.p, wpn === 'shotgun' ? 0.8 : 1.0);
          }
        } catch {}
      }

      if ((s.weapon || 'rifle') === 'rocket') {
        try {
          const to = new BABYLON.Vector3(s.ex, (s.ey || (s.sy || 1.8) - 0.2), s.ez);
          renderRocketProjectile(gunStart, to);
        } catch {}
      }

      if (s.from === myId) {
        flashReticle(s.hit ? 'hit' : 'shoot');
        const wpn = s.weapon || 'rifle';
        try { window.__lastShotWeapon = wpn; } catch {}
        const rc = RECOIL[wpn] || RECOIL.rifle;
        if (wpn === 'knife') {
          // Knife: animate swing instead of muzzle flash/tracers.
          try {
            const k = fpRig?.guns?.knife;
            if (k) {
              k.metadata = k.metadata || {};
              k.metadata._stab = 1.0;
            }
          } catch {}
        } else if (fpRig?.muzzleFlash && fpRig._flashBaseSize) {
          fpRig.muzzleFlash.scaling.setAll(rc.flashScale);
          fpRig.muzzleFlash.isVisible = true;
          applyRecoil(wpn);
          setTimeout(() => {
            if (fpRig?.muzzleFlash) fpRig.muzzleFlash.isVisible = false;
          }, 55);
        }
        if (wpn === 'rocket') { try { SFX.whoosh(); } catch {} }
        else if (wpn === 'knife') { /* no gun sound */ }
        else SFX.shoot(wpn);
        if (s.hit) {
          showHitmarker();
          const target = s.hit;
          const hp = (typeof s.hitHp === 'number') ? s.hitHp : null;
          const detail = hp === null ? `Hit ${target}` : `Hit ${target} (HP ${hp})`;
          showHitToast(detail);
          // Fart gun should feel goofy, not a "hit" beep.
          if ((s.weapon || 'rifle') !== 'fart') SFX.hit();
        }
      }

      if (s.hit && s.hit === myId && s.from !== myId) {
        flashReticle('hit');
      }

      if (s.hit && players.has(s.hit)) {
        const m = players.get(s.hit);
        const mat = m?.material;
        if (mat && mat.emissiveColor) {
          const prev = mat.emissiveColor.clone();
          mat.emissiveColor = new BABYLON.Color3(0.8, 0.1, 0.1);
          setTimeout(() => { try { mat.emissiveColor = prev; } catch {} }, 120);
        }
      }
    }

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
        if (!pickId && lastServerState && myId) {
          const me = lastServerState.players.find(p => p.id === myId);
          if (me) {
            for (const it of (lastServerState.pickups || [])) {
              if (it.type !== 'minigun') continue;
              if (it.kind === 'pad' && (it.availInMs||0) > 0) continue;
              if (it.kind === 'drop' && (it.expiresInMs||0) <= 0) continue;
              const d = Math.hypot(me.x - it.x, me.z - it.z);
              if (d <= 4.0) { pickId = it.id; break; }
            }
          }
        }
        if (!pickId) { showKill('Move closer to pick up!'); return; }

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
      try { btnWeaponPick?.classList?.add('isActive'); } catch {}
    }
    function closeWeaponModal() {
      weaponModal.classList.remove('open');
      try { btnWeaponPick?.classList?.remove('isActive'); } catch {}
    }
    function toggleWeaponModal() {
      try {
        if (weaponModal.classList.contains('open')) closeWeaponModal();
        else openWeaponModal();
      } catch {
        // fallback
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

    // Desktop QoL: ESC closes weapon modal
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

    const weaponChipEl = document.getElementById('weaponChip');
    function weaponLabel(id) {
      const map = {
        rifle: 'Rifle',
        shotgun: 'Shotgun',
        sniper: 'Sniper',
        fart: 'Fart',
        rocket: 'Rocket',
        knife: 'Knife',
        grenade_frag: 'Frag',
        grenade_impact: 'Impact',
        minigun: 'Minigun',
      };
      return map[id] || String(id || '');
    }
    function syncWeaponChip() {
      if (!weaponChipEl || !weaponEl) return;
      weaponChipEl.textContent = `🔫 ${weaponLabel(weaponEl.value)}`;
    }

    // Quick weapon access: tap the chip (when visible) to toggle the weapon picker.
    weaponChipEl?.addEventListener('pointerdown', (e) => {
      try { e.preventDefault(); e.stopPropagation(); } catch {}
      try { toggleWeaponModal?.(); } catch {}
    }, { passive:false });

    // Swap first-person gun model when weapon changes
    weaponEl?.addEventListener('change', () => {
      try { ensureFirstPersonRig()?.setGun?.(weaponEl.value); } catch {}
      // If switching away from sniper, force scope off.
      if (weaponEl.value !== 'sniper') state.scope = false;
      updateScopeUI();
      syncWeaponChip();
    });
    syncWeaponChip();
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
        // Fallback (older iOS / clipboard permissions): prompt so user can copy manually.
        try {
          window.prompt('Copy this link:', link);
          log('Copy link: select + copy from the prompt.');
        } catch {
          log('Copy failed. Link: ' + link);
        }
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
      try {
        soundBtn.textContent = 'Sound: ON';
        soundBtn.classList.add('soundOn');
      } catch {}
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
    // Ensure sound button starts in OFF state (sound is locked until user gesture on iOS).
    try {
      if (soundBtn) {
        soundBtn.textContent = 'Sound: OFF';
        soundBtn.classList.remove('soundOn');
      }
    } catch {}
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
      // Low-HP warning beep (arcade tension)
      try {
        const me = (lastServerState && myId) ? lastServerState.players.find(p=>String(p.id)===String(myId)) : null;
        const hp = me?.hp ?? null;
        const inv = me?.invulnInMs ?? 0;
        if (hp != null && hp > 0 && hp <= 25 && inv <= 0) {
          const now = performance.now();
          if (!window.__kb_lowHpAt || (now - window.__kb_lowHpAt) > 1200) {
            window.__kb_lowHpAt = now;
            try { SFX.lowhp?.(); } catch {}
          }
        }
      } catch {}

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
