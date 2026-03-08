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
        // Mansion v2 (ultra-lite): keep visuals aligned with server.js
        // Perimeter walls removed (outer ring)
        // Pool (two low rims)
        { x: -11, y: 0, z: -14, w: 1.0, h: 1.15, d: 9.0 },
        { x: -5, y: 0, z: -14, w: 1.0, h: 1.15, d: 9.0 },

        // Courtyard micro-cover (matches server.js): breaks the longest gate→door sightline
        { x: 0.0, y: 0, z: -12.0, w: 3.0, h: 1.15, d: 1.0 },
        { x: -6.0, y: 0, z: -12.0, w: 2.4, h: 1.15, d: 1.0 },

        // Facade + door choke
        { x: -9.5, y: 0, z: -6, w: 11, h: 4.6, d: 2 },
        { x: 9.5, y: 0, z: -6, w: 11, h: 4.6, d: 2 },
        { x: -1.7, y: 0, z: -6, w: 1.2, h: 4.6, d: 2.2 },
        { x: 1.7, y: 0, z: -6, w: 1.2, h: 4.6, d: 2.2 },

        // Interior back wall
        { x: 0, y: 0, z: 10.5, w: 22, h: 4.6, d: 2 },

        // Sniper tower (visuals must match server.js)
        { x: -18.0, y: 0, z: 18.0, w: 3.2, h: 22.0, d: 3.2 },
        { x: -18.0, y: 22.0, z: 18.0, w: 8.0, h: 1.2, d: 8.0 },

        // Jump props
        { x: -2.0, y: 0, z: -18.0, w: 2.4, h: 1.15, d: 2.4 },
        { x: 2.0, y: 0, z: -18.0, w: 2.4, h: 1.15, d: 2.4 },
        { x: -8.0, y: 0, z: -11.0, w: 2.2, h: 1.15, d: 2.2 },
        { x: 2.0, y: 0, z: -9.0, w: 2.2, h: 1.15, d: 2.2 },

        // Courtyard-right sniper tower (jump-climb)
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

        // Avoid stacking multiple RAF loops if updateScopeUI() is called repeatedly mid-lerp.
        if (k < 1) {
          if (!updateScopeUI._rafScheduled) {
            updateScopeUI._rafScheduled = true;
            requestAnimationFrame(() => {
              updateScopeUI._rafScheduled = false;
              updateScopeUI();
            });
          }
        }

        scope.isVisible = scoped;
        scopeLines.isVisible = scoped;
        ret.isVisible = !scoped;

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
      // Kick values are in radians (camera) and meters-ish (gunRoot position).
      // This tick is "GUN recoil" (task #1): strong, readable kick + springy recovery.
      // NOTE: Screen shake is task #2, so keep shake handling minimal here.
      //
      // gunKick: pull viewmodel back (z)
      // gunLift: lift viewmodel up (y)
      // gunSide: small sideways shove (x)
      // rollKick: tiny roll torque so the gun feels like it twists in your hands
      rifle:   { gunKick: 0.210, gunLift: 0.045, gunSide: 0.012, rollKick: 0.034, pitchKick: 0.125, yawKick: 0.0160, flashScale: 1.05 },
      shotgun: { gunKick: 0.220, gunLift: 0.050, gunSide: 0.016, rollKick: 0.055, pitchKick: 0.115, yawKick: 0.0140, flashScale: 1.90 },
      sniper:  { gunKick: 0.240, gunLift: 0.040, gunSide: 0.004, rollKick: 0.020, pitchKick: 0.140, yawKick: 0.0040, flashScale: 1.55 },
      fart:    { gunKick: 0.040, gunLift: 0.012, gunSide: 0.004, rollKick: 0.010, pitchKick: 0.016, yawKick: 0.0060, flashScale: 0.75 },
      minigun: { gunKick: 0.070, gunLift: 0.018, gunSide: 0.010, rollKick: 0.038, pitchKick: 0.028, yawKick: 0.0090, flashScale: 2.10 },
      rocket:  { gunKick: 0.170, gunLift: 0.045, gunSide: 0.018, rollKick: 0.060, pitchKick: 0.070, yawKick: 0.0135, flashScale: 2.20 },
      tank:    { gunKick: 0.250, gunLift: 0.055, gunSide: 0.025, rollKick: 0.075, pitchKick: 0.090, yawKick: 0.0160, flashScale: 4.50 },
    };

    // Recoil is rendered client-side only (does NOT affect server aim/look).
    // Stored on window so the render loop can apply/decay it every frame.
    function applyRecoil(weapon) {
      const r0 = RECOIL[weapon] || RECOIL.rifle;

      // Recoil ramp: consecutive shots feel punchier (especially on auto weapons),
      // but resets quickly after you pause. This is visual only.
      let mult = 1.0;
      try {
        const now = performance.now();
        const last = (typeof window.__hbLastRecoilAt === 'number') ? window.__hbLastRecoilAt : 0;
        const streak = (typeof window.__hbRecoilStreak === 'number') ? window.__hbRecoilStreak : 0;

        const windowMs = (weapon === 'minigun') ? 110
          : (weapon === 'rifle') ? 160
          : (weapon === 'shotgun') ? 220
          : (weapon === 'sniper') ? 260
          : 180;

        const nextStreak = (now - last) <= windowMs ? Math.min(10, streak + 1) : 0;
        window.__hbRecoilStreak = nextStreak;
        window.__hbLastRecoilAt = now;

        // A gentle ramp: +0% … +55% max.
        mult = 1.0 + Math.min(0.55, nextStreak * 0.065);

        // Keep single-tap rifle satisfying even when not streaking.
        if (weapon === 'rifle' && nextStreak === 0) mult = 1.25;
      } catch {}

      // Copy (so we can scale per-shot without mutating constants)
      const r = {
        gunKick: (r0.gunKick || 0) * mult,
        gunLift: (r0.gunLift || 0) * mult,
        gunSide: (r0.gunSide || 0) * mult,
        rollKick: (r0.rollKick || 0) * mult,
        pitchKick: (r0.pitchKick || 0) * mult,
        yawKick: (r0.yawKick || 0) * mult,
        flashScale: (r0.flashScale || 1),
      };

      // ── Gun model recoil (kick + torque) ──
      // Make the viewmodel *move* (not just rotate) so recoil is obvious on mobile.
      // IMPORTANT: we apply recoil as spring-driven offsets (metadata), NOT by directly
      // moving the mesh every shot. This makes kick + recovery feel snappier and more physical.
      try {
        const g = fpRig?.gunRoot;
        if (g) {
          g.metadata = g.metadata || {};
          const md = g.metadata;

          // Base pose (captured once)
          if (typeof md._basePosX !== 'number') md._basePosX = g.position.x;
          if (typeof md._basePosY !== 'number') md._basePosY = g.position.y;
          if (typeof md._basePosZ !== 'number') md._basePosZ = g.position.z;
          if (typeof md._baseRotX !== 'number') md._baseRotX = g.rotation.x;
          if (typeof md._baseRotY !== 'number') md._baseRotY = g.rotation.y;
          if (typeof md._baseRotZ !== 'number') md._baseRotZ = g.rotation.z;

          // Recoil offsets + velocities (spring sim in render loop)
          if (typeof md._rPosX !== 'number') md._rPosX = 0;
          if (typeof md._rPosY !== 'number') md._rPosY = 0;
          if (typeof md._rPosZ !== 'number') md._rPosZ = 0;
          if (typeof md._rRotX !== 'number') md._rRotX = 0;
          if (typeof md._rRotY !== 'number') md._rRotY = 0;
          if (typeof md._rRotZ !== 'number') md._rRotZ = 0;

          if (typeof md._rVelPosX !== 'number') md._rVelPosX = 0;
          if (typeof md._rVelPosY !== 'number') md._rVelPosY = 0;
          if (typeof md._rVelPosZ !== 'number') md._rVelPosZ = 0;
          if (typeof md._rVelRotX !== 'number') md._rVelRotX = 0;
          if (typeof md._rVelRotY !== 'number') md._rVelRotY = 0;
          if (typeof md._rVelRotZ !== 'number') md._rVelRotZ = 0;

          const sideSign = (weapon === 'rifle' || weapon === 'minigun') ? 1 : -1;
          const sideJitter = (Math.random() - 0.5) * (r.gunSide || 0) * 0.65;

          // Position kick (offset space)
          md._rPosZ -= (r.gunKick || 0);
          md._rPosY += (r.gunLift || 0);
          md._rPosX += sideSign * (r.gunSide || 0) + sideJitter;

          // Torque (offset space)
          md._rRotX += (r.pitchKick || 0) * 1.25;
          md._rRotY += (r.yawKick || 0) * ((weapon === 'rifle') ? 1.15 : 0.55);
          md._rRotZ += sideSign * (r.rollKick || 0);

          // Extra snap: small impulse to velocity so recoil feels instantaneous even
          // with spring recovery.
          md._rVelPosZ -= (r.gunKick || 0) * 6.0;
          md._rVelRotX += (r.pitchKick || 0) * 7.0;
        }
      } catch {}

      // ── Camera recoil (pure kick; does NOT affect server aim/look) ──
      try {
        if (typeof window.__camKickPitch !== 'number') window.__camKickPitch = 0;
        if (typeof window.__camKickYaw !== 'number') window.__camKickYaw = 0;

        // Bias rifle slightly up-right; keep others mostly straight.
        const yawBias = (weapon === 'rifle') ? 0.85 : (weapon === 'minigun') ? 0.15 : 0.0;
        const yawJitter = (Math.random() - 0.5) * r.yawKick * 0.55;
        const yawKick = yawBias * r.yawKick + yawJitter;

        // Cap accumulation so burst fire feels punchy without going totally off-screen.
        // Slightly higher cap now that recoil ramps per-shot.
        window.__camKickPitch = Math.min(0.45, window.__camKickPitch + r.pitchKick);
        window.__camKickYaw   = Math.max(-0.24, Math.min(0.24, window.__camKickYaw + yawKick));
      } catch {}

      // ── Screen shake impulse (visual only) ──
      // This tick is task #2: give every gunshot a quick, readable jolt.
      try {
        if (typeof window.__hbShakeTrauma !== 'number') window.__hbShakeTrauma = 0;
        if (typeof window.__hbShakeSeed !== 'number') window.__hbShakeSeed = 0;

        // Per-weapon impulse tuning: make the shake read clearly on iPhone
        // without becoming a constant wobble.
        const add = (weapon === 'shotgun') ? 0.34
          : (weapon === 'sniper') ? 0.30
          : (weapon === 'rocket') ? 0.44
          : (weapon === 'tank') ? 0.52
          : (weapon === 'minigun') ? 0.11
          : (weapon === 'fart') ? 0.05
          : 0.20; // rifle default

        window.__hbShakeTrauma = Math.min(1.0, window.__hbShakeTrauma + add);
        window.__hbShakeSeed = (window.__hbShakeSeed + 1) % 1000000;
      } catch {}
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
                mechGain: 0.022,
                tailDelayMs: 34,
                tailGain: 0.11,
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
                mechGain: 0.018,
                tailDelayMs: 34,
                tailGain: 0.10,
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
                mechGain: 0.004,
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
                mechGain: 0.008,
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
                mechGain: 0.016,
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

          // ── Task #4: Gun sound layering ──
          // Add a subtle "mechanical clack" transient + a very short tail.
          // This makes shots feel less like pure noise and more like a gun (mechanism + space).
          // Keep it tiny so it doesn't fatigue on auto weapons.
          try {
            // Mechanical clack: very short high-passed noise burst.
            const mech = c.createBufferSource();
            mech.buffer = noiseBuffer(c, 0.020);

            const hp = c.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.setValueAtTime((cfg.mechHpHz || 1800), t0);

            const mbp = c.createBiquadFilter();
            mbp.type = 'bandpass';
            mbp.frequency.setValueAtTime((cfg.mechBpHz || 3200), t0);
            mbp.Q.setValueAtTime((cfg.mechBpQ || 1.1), t0);

            const mg = c.createGain();
            const mechGain = (typeof cfg.mechGain === 'number') ? cfg.mechGain : 0.020;
            mg.gain.setValueAtTime(0.0001, t0);
            mg.gain.exponentialRampToValueAtTime(mechGain, t0 + 0.002);
            mg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.030);

            mech.connect(hp).connect(mbp).connect(mg).connect(mix);
            mech.start(t0);
            mech.stop(t0 + 0.032);
          } catch {}

          try {
            // Micro-tail: quick delay+feedback to add a hint of space (esp. shotgun/sniper/rocket).
            // We intentionally keep this "too short" to avoid obvious echo.
            const tailDelayMs = (typeof cfg.tailDelayMs === 'number') ? cfg.tailDelayMs : ((w === 'shotgun' || w === 'sniper' || w === 'rocket' || w === 'tank') ? 34 : 0);
            const tailGainVal = (typeof cfg.tailGain === 'number') ? cfg.tailGain : ((w === 'shotgun') ? 0.11 : (w === 'sniper') ? 0.10 : (w === 'rocket' || w === 'tank') ? 0.12 : 0.00);
            if (tailDelayMs > 0 && tailGainVal > 0) {
              const d = c.createDelay(0.2);
              d.delayTime.setValueAtTime(tailDelayMs / 1000, t0);
              const fb = c.createGain();
              fb.gain.value = 0.22;
              const tg = c.createGain();
              tg.gain.value = tailGainVal;
              // route: mix -> delay -> (tail out) + feedback
              mix.connect(d);
              d.connect(tg).connect(c.destination);
              d.connect(fb).connect(d);

              // Auto-fade tail bus so it doesn't keep ringing if browser keeps nodes alive.
              tg.gain.setValueAtTime(tailGainVal, t0);
              tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
            }
          } catch {}

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
        cast: () => (function(){
          // Fishing pole cast: rising whistling swish + light "plop" at end
          play((c) => {
            const t0 = c.currentTime + 0.001;
            // Swish: filtered noise swept high
            const n = c.createBufferSource();
            n.buffer = noiseBuffer(c, 0.22);
            const bp = c.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.setValueAtTime(800, t0);
            bp.frequency.linearRampToValueAtTime(3200, t0 + 0.18);
            bp.Q.setValueAtTime(2.5, t0);
            const ng = c.createGain();
            ng.gain.setValueAtTime(0.0001, t0);
            ng.gain.exponentialRampToValueAtTime(0.18, t0 + 0.04);
            ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
            n.connect(bp).connect(ng).connect(c.destination);
            n.start(t0); n.stop(t0 + 0.22);
            // Plop: short sine blip
            const o = c.createOscillator();
            const og = c.createGain();
            o.type = 'sine';
            o.frequency.setValueAtTime(520, t0 + 0.20);
            o.frequency.exponentialRampToValueAtTime(280, t0 + 0.30);
            og.gain.setValueAtTime(0.0001, t0 + 0.20);
            og.gain.exponentialRampToValueAtTime(0.10, t0 + 0.22);
            og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
            o.connect(og).connect(c.destination);
            o.start(t0 + 0.20); o.stop(t0 + 0.32);
          });
        })(),
        cannon: () => (function(){
          // Tank cannon shot: sharp CRACK + deep rolling BOOM + low rumble
          play((c) => {
            const t0 = c.currentTime + 0.001;
            // Deep bass boom
            const o = c.createOscillator();
            const gn = c.createGain();
            o.type = 'sine';
            o.frequency.setValueAtTime(90, t0);
            o.frequency.exponentialRampToValueAtTime(22, t0 + 0.55);
            gn.gain.setValueAtTime(0.0001, t0);
            gn.gain.exponentialRampToValueAtTime(0.52, t0 + 0.006);
            gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.70);
            o.connect(gn).connect(c.destination);
            o.start(t0); o.stop(t0 + 0.75);
            // Sharp crack (mid-high noise burst)
            const n1 = c.createBufferSource();
            n1.buffer = noiseBuffer(c, 0.15);
            const hp1 = c.createBiquadFilter();
            hp1.type = 'bandpass';
            hp1.frequency.setValueAtTime(900, t0);
            hp1.Q.setValueAtTime(0.8, t0);
            const ng1 = c.createGain();
            ng1.gain.setValueAtTime(0.0001, t0);
            ng1.gain.exponentialRampToValueAtTime(0.45, t0 + 0.004);
            ng1.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
            n1.connect(hp1).connect(ng1).connect(c.destination);
            n1.start(t0); n1.stop(t0 + 0.20);
            // Low rolling rumble
            const n2 = c.createBufferSource();
            n2.buffer = noiseBuffer(c, 0.65);
            const lp2 = c.createBiquadFilter();
            lp2.type = 'lowpass';
            lp2.frequency.setValueAtTime(110, t0);
            const ng2 = c.createGain();
            ng2.gain.setValueAtTime(0.0001, t0 + 0.04);
            ng2.gain.exponentialRampToValueAtTime(0.30, t0 + 0.12);
            ng2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.75);
            n2.connect(lp2).connect(ng2).connect(c.destination);
            n2.start(t0); n2.stop(t0 + 0.80);
          });
        })(),
        tankEngineStart: () => {
          // Starts looping engine hum, returns a stop() function.
          let src = null, gainNode = null;
          try {
            const c = getCtx();
            if (!c) return () => {};
            const buf = noiseBuffer(c, 0.5);
            src = c.createBufferSource();
            src.buffer = buf;
            src.loop = true;
            const lp = c.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.setValueAtTime(75, c.currentTime);
            gainNode = c.createGain();
            gainNode.gain.setValueAtTime(0.10, c.currentTime);
            src.connect(lp).connect(gainNode).connect(c.destination);
            src.start();
          } catch {}
          return () => { try { src && src.stop(); } catch {} try { gainNode && gainNode.disconnect(); } catch {} };
        },
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
