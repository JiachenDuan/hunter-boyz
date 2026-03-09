
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
        const isTank = msg.kind === 'tank';
        const scale = isTank ? 2.8 : 1.0;

        // Visual: expanding fireball + flash + smoke
        const sphere = BABYLON.MeshBuilder.CreateSphere(`ex_${Date.now()}`, { diameter: 0.6 * scale, segments: 10 }, scene);

        const flash = BABYLON.MeshBuilder.CreateSphere(`exFlash_${Date.now()}`, { diameter: 0.35 * scale, segments: 8 }, scene);
        flash.position.set(x, y, z);
        flash.isPickable = false;
        const fmat = new BABYLON.StandardMaterial(`exFlashM_${Date.now()}`, scene);
        fmat.diffuseColor = new BABYLON.Color3(1,1,1);
        fmat.emissiveColor = new BABYLON.Color3(1,1,1);
        fmat.alpha = 0.9;
        fmat.disableLighting = true;
        flash.material = fmat;


        const ring = BABYLON.MeshBuilder.CreateTorus(`exr_${Date.now()}`, { diameter: 0.8 * scale, thickness: 0.05 * scale, tessellation: 28 }, scene);
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
        const numPuffs = isTank ? 14 : 7;
        for (let i = 0; i < numPuffs; i++) {
          const puff = BABYLON.MeshBuilder.CreateSphere(`exs_${Date.now()}_${i}`, { diameter: 0.45 * scale, segments: 8 }, scene);
          puff.isPickable = false;
          puff.position.set(x + (Math.random()-0.5)*0.8*scale, y + (Math.random()-0.5)*0.4*scale, z + (Math.random()-0.5)*0.8*scale);
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
        try { isTank ? SFX.cannon() : SFX.boom(); } catch {}

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
      // Keep scoreboard rendering injection-safe: build DOM nodes (no innerHTML).
      // Also keeps styling centralized in CSS for easier iteration.
      try {
        const body = document.getElementById('scoreboardBody');
        if (!body) return;

        const safeText = (v) => {
          if (v === null || v === undefined) return '';
          return String(v);
        };

        const safeCssColor = (c) => {
          // Allow: #rgb/#rrggbb, rgb(), rgba(). Anything else -> neutral.
          const s = safeText(c).trim();
          if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return s;
          const m = s.match(/^rgba?\(([^)]+)\)$/i);
          if (m) {
            const parts = m[1].split(',').map(x => x.trim());
            if (parts.length === 3 || parts.length === 4) {
              const r = Number(parts[0]), g = Number(parts[1]), b = Number(parts[2]);
              const a = parts.length === 4 ? Number(parts[3]) : null;
              const okCh = (n) => Number.isFinite(n) && n >= 0 && n <= 255;
              const okA  = (n) => Number.isFinite(n) && n >= 0 && n <= 1;
              if (okCh(r) && okCh(g) && okCh(b) && (a === null || okA(a))) {
                return a === null ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
              }
            }
          }
          return 'rgba(255,255,255,0.65)';
        };

        // Clear existing.
        body.textContent = '';

        const meId = String(state.me || '');
        // Stable-ish ordering: score desc, then deaths asc, then name asc.
        // Helps prevent "jumping" rows when players are tied on score.
        const rows = (s.players || []).slice().sort((a, b) => {
          const sa = Number(a?.score || 0);
          const sb = Number(b?.score || 0);
          if (sb !== sa) return sb - sa;

          const da = Number(a?.deaths || 0);
          const db = Number(b?.deaths || 0);
          if (da !== db) return da - db;

          const na = String(a?.name || '').toLowerCase();
          const nb = String(b?.name || '').toLowerCase();
          if (na < nb) return -1;
          if (na > nb) return 1;
          return 0;
        });
        if (!rows.length) {
          const empty = document.createElement('div');
          empty.className = 'scoreboardEmpty';
          empty.textContent = 'No players.';
          body.appendChild(empty);
          return;
        }

        for (let i = 0; i < rows.length; i++) {
          const p = rows[i] || {};
          const isMe = String(p.id) === meId;

          const row = document.createElement('div');
          const rankClass = i === 0 ? ' top1' : (i === 1 ? ' top2' : (i === 2 ? ' top3' : ''));
          row.className = 'scoreboardRow' + rankClass + (isMe ? ' me' : '');

          const left = document.createElement('div');
          left.className = 'scoreboardLeft';

          const dot = document.createElement('span');
          dot.className = 'scoreboardDot';
          dot.style.background = safeCssColor(p.color);

          const name = document.createElement('span');
          name.className = 'scoreboardName';
          name.textContent = `${i + 1}. ${safeText(p.name)}`;

          left.appendChild(dot);
          left.appendChild(name);

          if (isMe) {
            const badge = document.createElement('span');
            badge.className = 'scoreboardBadge';
            badge.textContent = 'YOU';
            badge.setAttribute('aria-label', 'You');
            left.appendChild(badge);
          }

          const right = document.createElement('div');
          right.className = 'scoreboardRight';

          const k = document.createElement('span');
          k.className = 'scoreboardK';
          k.textContent = `K ${Number(p.score || 0)}`;

          const d = document.createElement('span');
          d.className = 'scoreboardD';
          d.textContent = `D ${Number(p.deaths || 0)}`;

          right.appendChild(k);
          right.appendChild(document.createTextNode(' '));
          right.appendChild(d);

          row.appendChild(left);
          row.appendChild(right);
          body.appendChild(row);
        }
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

    // Task #12: TANK hull impact sparks (bigger + longer than regular bullet pings).
    // Still lightweight: a couple of emissive flashes, capped to ONE at a time.
    function spawnTankHullSparks(pos, intensity = 1) {
      try {
        if (!scene || !pos) return;

        if (window.__lastTankHullFlash) {
          try { window.__lastTankHullFlash.dispose(); } catch {}
          window.__lastTankHullFlash = null;
        }

        const k = Math.max(0.7, Math.min(2.0, +intensity || 1));
        const sz = 0.42 + 0.18 * k;

        const flash = BABYLON.MeshBuilder.CreatePlane('tankHullFlash', { size: sz }, scene);
        flash.position = pos.clone();
        flash.position.y += 0.12;
        flash.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        flash.isPickable = false;

        const mat = new BABYLON.StandardMaterial('tankHullFlashMat', scene);
        // Hot-white with a blue-ish metal edge so it reads as "sparks" vs muzzle flash.
        mat.diffuseColor  = new BABYLON.Color3(0.92, 0.96, 1.0);
        mat.emissiveColor = new BABYLON.Color3(0.75, 0.90, 1.0);
        mat.specularColor = new BABYLON.Color3(0, 0, 0);
        mat.alpha = 0.95;
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        flash.material = mat;

        window.__lastTankHullFlash = flash;

        // NEW: a brief impact light so the whole tank hull "pops" on iPhone.
        // (This is the major visible part of Task #12.)
        let light = null;
        try {
          light = new BABYLON.PointLight('tankHullImpactLight', pos.clone(), scene);
          light.diffuse = new BABYLON.Color3(0.78, 0.90, 1.0);
          light.specular = new BABYLON.Color3(0.9, 0.95, 1.0);
          light.range = 10 + 8 * k;
          light.intensity = 6.0 * k;
          light.metadata = { _hbTankHull: true };
        } catch {}

        // Optional tiny secondary flashes + streak so it reads as "sparks" not just a blob.
        let flash2 = null;
        let mat2 = null;
        let flash3 = null;
        let mat3 = null;
        try {
          flash2 = BABYLON.MeshBuilder.CreatePlane('tankHullFlash2', { size: sz * 0.75 }, scene);
          flash2.position = pos.clone();
          flash2.position.y += 0.10;
          flash2.position.x += (Math.random() - 0.5) * 0.28;
          flash2.position.z += (Math.random() - 0.5) * 0.28;
          flash2.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
          flash2.isPickable = false;
          mat2 = new BABYLON.StandardMaterial('tankHullFlashMat2', scene);
          mat2.diffuseColor = new BABYLON.Color3(1.0, 0.92, 0.70);
          mat2.emissiveColor = new BABYLON.Color3(1.0, 0.86, 0.50);
          mat2.specularColor = new BABYLON.Color3(0,0,0);
          mat2.alpha = 0.92;
          mat2.disableLighting = true;
          mat2.backFaceCulling = false;
          flash2.material = mat2;

          // A thin "streak" that scales outward quickly.
          flash3 = BABYLON.MeshBuilder.CreatePlane('tankHullFlash3', { width: sz * 1.25, height: sz * 0.22 }, scene);
          flash3.position = pos.clone();
          flash3.position.y += 0.11;
          flash3.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
          flash3.rotation.z = (Math.random() - 0.5) * Math.PI;
          flash3.isPickable = false;
          mat3 = new BABYLON.StandardMaterial('tankHullFlashMat3', scene);
          mat3.diffuseColor = new BABYLON.Color3(0.95, 0.98, 1.0);
          mat3.emissiveColor = new BABYLON.Color3(0.80, 0.92, 1.0);
          mat3.specularColor = new BABYLON.Color3(0,0,0);
          mat3.alpha = 0.80;
          mat3.disableLighting = true;
          mat3.backFaceCulling = false;
          flash3.material = mat3;
        } catch {}

        const start = performance.now();
        const dur = 420;
        const tick = () => {
          const t = performance.now() - start;
          const kk = Math.min(1, t / dur);
          try {
            // Fast initial pop, then long tail.
            const tail = Math.pow(1 - kk, 1.55);
            mat.alpha = 0.98 * tail;
            flash.scaling.setAll(1.0 + kk * 0.70);
          } catch {}
          try {
            if (flash2 && mat2) {
              const tail2 = Math.pow(1 - kk, 1.75);
              mat2.alpha = 0.92 * tail2;
              flash2.scaling.setAll(1.0 + kk * 1.10);
            }
          } catch {}
          try {
            if (flash3 && mat3) {
              const tail3 = Math.pow(1 - kk, 2.1);
              mat3.alpha = 0.80 * tail3;
              flash3.scaling.x = 1.0 + kk * 1.9;
              flash3.scaling.y = 1.0 + kk * 0.25;
            }
          } catch {}
          try {
            if (light) {
              // Very bright for the first ~2 frames, then decay quickly.
              const pop = (kk < 0.10) ? 1.0 : Math.pow(1 - kk, 2.6);
              light.intensity = (6.0 * k) * pop;
            }
          } catch {}

          if (kk < 1) requestAnimationFrame(tick);
          else {
            try { flash.dispose(); } catch {}
            try { mat.dispose(); } catch {}
            try { if (flash2) flash2.dispose(); } catch {}
            try { if (mat2) mat2.dispose(); } catch {}
            try { if (flash3) flash3.dispose(); } catch {}
            try { if (mat3) mat3.dispose(); } catch {}
            try { if (light) light.dispose(); } catch {}
            if (window.__lastTankHullFlash === flash) window.__lastTankHullFlash = null;
          }
        };
        requestAnimationFrame(tick);
      } catch {}
    }


    // ── Task #13: TANK destruction (visual only) ──
    // Big readable boom + lingering smoke when a tank is actually destroyed.
    // Kept client-side so it doesn't change gameplay/authoritative state.
    function spawnTankDestruction(pos, intensity = 1) {
      try {
        if (!scene || !pos) return;

        // Cap to one active destruction effect so we don't stack smoke balls.
        if (window.__lastTankDestruction) {
          try { window.__lastTankDestruction.dispose?.(); } catch {}
          window.__lastTankDestruction = null;
        }

        const k = Math.max(0.8, Math.min(2.4, +intensity || 1));

        // Bright flash sphere
        const flash = BABYLON.MeshBuilder.CreateSphere('tankBoomFlash', { diameter: 1.0 * k, segments: 10 }, scene);
        flash.position = pos.clone();
        flash.position.y += 0.15;
        flash.isPickable = false;

        const fmat = new BABYLON.StandardMaterial('tankBoomFlashMat', scene);
        fmat.diffuseColor = new BABYLON.Color3(1, 1, 1);
        fmat.emissiveColor = new BABYLON.Color3(1.0, 0.86, 0.45);
        fmat.specularColor = new BABYLON.Color3(0, 0, 0);
        fmat.alpha = 0.95;
        fmat.disableLighting = true;
        flash.material = fmat;

        // Smoke puffs (billboard spheres)
        const smokes = [];
        const puffCount = 10;
        for (let i = 0; i < puffCount; i++) {
          const puff = BABYLON.MeshBuilder.CreateSphere('tankBoomSmoke', { diameter: (0.55 + Math.random() * 0.35) * k, segments: 8 }, scene);
          puff.isPickable = false;
          puff.position = pos.clone();
          puff.position.y += 0.20 + Math.random() * 0.35;
          puff.position.x += (Math.random() - 0.5) * 0.95 * k;
          puff.position.z += (Math.random() - 0.5) * 0.95 * k;

          const sm = new BABYLON.StandardMaterial('tankBoomSmokeMat', scene);
          sm.diffuseColor = new BABYLON.Color3(0.12, 0.12, 0.13);
          sm.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.02);
          sm.specularColor = new BABYLON.Color3(0, 0, 0);
          sm.alpha = 0.45;
          sm.disableLighting = true;
          puff.material = sm;
          smokes.push({ puff, sm, dx: (Math.random() - 0.5) * 0.9, dz: (Math.random() - 0.5) * 0.9, dy: 0.55 + Math.random() * 0.35 });
        }

        // Shrapnel streaks (short-lived emissive lines)
        const streaks = [];
        for (let i = 0; i < 10; i++) {
          const ang = Math.random() * Math.PI * 2;
          const len = (0.8 + Math.random() * 1.25) * k;
          const p1 = new BABYLON.Vector3(pos.x, pos.y + 0.18, pos.z);
          const p2 = new BABYLON.Vector3(pos.x + Math.cos(ang) * len, pos.y + (Math.random() - 0.15) * 0.65 * k, pos.z + Math.sin(ang) * len);
          const line = BABYLON.MeshBuilder.CreateLines('tankBoomLine', { points: [p1, p2] }, scene);
          line.isPickable = false;
          line.color = new BABYLON.Color3(1.0, 0.78, 0.25);
          line.alpha = 0.85;
          streaks.push(line);
        }

        // Optional sound hook (if present)
        try {
          if (SFX && typeof SFX.tankBoom === 'function') SFX.tankBoom(k);
        } catch {}

        // Animate + clean up
        const start = performance.now();
        const dur = 1400;

        // A tiny container object so we can dispose all via one reference.
        window.__lastTankDestruction = {
          dispose: () => {
            try { flash.dispose(); } catch {}
            try { fmat.dispose(); } catch {}
            for (const s of smokes) {
              try { s.puff.dispose(); } catch {}
              try { s.sm.dispose(); } catch {}
            }
            for (const l of streaks) { try { l.dispose(); } catch {} }
          },
        };

        const tick = () => {
          const t = performance.now() - start;
          const a = Math.min(1, t / dur);

          try {
            // Flash: fast pop then vanish.
            const flashA = Math.max(0, 1 - a * 4.0);
            fmat.alpha = 0.95 * flashA;
            flash.scaling.setAll(1.0 + a * 4.0);
          } catch {}

          try {
            // Smoke rises + slowly expands.
            for (const s of smokes) {
              s.puff.position.y += s.dy * 0.010;
              s.puff.position.x += s.dx * 0.008;
              s.puff.position.z += s.dz * 0.008;
              const sc = 1.0 + a * 2.4;
              s.puff.scaling.setAll(sc);
              s.sm.alpha = 0.45 * (1 - a);
            }
          } catch {}

          try {
            // Streaks fade quickly.
            for (const l of streaks) {
              l.alpha = Math.max(0, 0.85 * (1 - a * 2.5));
            }
          } catch {}

          if (a < 1) requestAnimationFrame(tick);
          else {
            try { window.__lastTankDestruction?.dispose?.(); } catch {}
            window.__lastTankDestruction = null;
          }
        };
        requestAnimationFrame(tick);
        setTimeout(() => {
          try { window.__lastTankDestruction?.dispose?.(); } catch {}
          window.__lastTankDestruction = null;
        }, dur + 200);
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

      // ── Task #3: GUN muzzle flash dynamic light (third-person) ──
      // First-person already has a viewmodel muzzle light; this adds a short-lived
      // world-space muzzle light + flash sprite for OTHER players so firefights read
      // better (especially on iPhone captures).
      try {
        if (s.from !== myId && scene && gunStart) {
          const w = (s.weapon || 'rifle');
          const isProj = (w === 'rocket' || w === 'tank' || String(w).startsWith('grenade_'));
          const isKnife2 = (w === 'knife');
          if (!isKnife2 && !isProj) {
            if (!window.__hbTppMuzzleFx) window.__hbTppMuzzleFx = {};
            const key = String(s.from || '');
            const prev = window.__hbTppMuzzleFx[key];
            try {
              if (prev && prev.dispose) prev.dispose();
            } catch {}

            const warm = (w === 'shotgun')
              ? new BABYLON.Color3(1.0, 0.68, 0.20)
              : (w === 'sniper')
                ? new BABYLON.Color3(1.0, 0.84, 0.32)
                : (w === 'minigun')
                  ? new BABYLON.Color3(1.0, 0.92, 0.40)
                  : new BABYLON.Color3(1.0, 0.92, 0.45);

            // Small muzzle flash billboard so the light has an obvious visible source.
            const flash = BABYLON.MeshBuilder.CreatePlane(`tppMuzzle_${Date.now()}`, { size: (w === 'shotgun') ? 0.42 : 0.32 }, scene);
            flash.position.copyFrom(gunStart);
            flash.isPickable = false;
            flash.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
            const mat = new BABYLON.StandardMaterial(`tppMuzzleMat_${Date.now()}`, scene);
            mat.emissiveColor = warm;
            mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
            mat.specularColor = new BABYLON.Color3(0, 0, 0);
            mat.alpha = 0.95;
            mat.disableLighting = true;
            flash.material = mat;

            const light = new BABYLON.PointLight(`tppMuzzleLight_${Date.now()}`, gunStart.clone(), scene);
            light.diffuse = warm;
            light.specular = warm;
            light.intensity = (w === 'shotgun') ? 6.0 : (w === 'sniper') ? 4.6 : (w === 'minigun') ? 3.2 : 4.0;
            light.range = (w === 'shotgun') ? 10.5 : (w === 'sniper') ? 9.0 : (w === 'minigun') ? 7.0 : 8.5;

            const fx = {
              dispose: () => {
                try { flash.dispose(); } catch {}
                try { light.dispose(); } catch {}
              }
            };
            window.__hbTppMuzzleFx[key] = fx;

            // Quick pulse + warm afterglow so it reads clearly on mobile.
            setTimeout(() => { try { mat.alpha = 0.55; light.intensity *= 0.55; } catch {} }, 60);
            setTimeout(() => { try { mat.alpha = 0.22; light.intensity *= 0.35; } catch {} }, 140);
            setTimeout(() => {
              try {
                if (window.__hbTppMuzzleFx && window.__hbTppMuzzleFx[key] === fx) delete window.__hbTppMuzzleFx[key];
              } catch {}
              fx.dispose();
            }, 220);
          }
        }
      } catch {}

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
          // Dispose ALL active tracers (any weapon) before drawing a new one.
          // Task #7: GUN bullet tracers (major + readable on iPhone)
          for (const k of Object.keys(window.__lastTracerByWeapon)) {
            const prev = window.__lastTracerByWeapon[k];
            const list = Array.isArray(prev) ? prev : [prev];
            for (const m of list) {
              if (m && !m.isDisposed?.()) { try { m.dispose(); } catch {} }
            }
            delete window.__lastTracerByWeapon[k];
          }
        } catch {}

        const pts = segments[0];
        if (pts) {
          // Two-layer tracer so it reads as a bright "core" with a softer halo.
          // (Still cheap: two low-tess tubes, short TTL.)
          const baseRadius = (wpn0 === 'sniper') ? 0.080 : (wpn0 === 'shotgun') ? 0.065 : (wpn0 === 'minigun') ? 0.052 : 0.058;
          const coreRadius = Math.max(0.028, baseRadius * 0.55);
          const haloRadius = baseRadius * 1.28;

          const makeTube = (name, radius) => {
            const t = BABYLON.MeshBuilder.CreateTube(name, {
              path: pts,
              radius,
              cap: BABYLON.Mesh.CAP_ALL,
              tessellation: 6,
              updatable: false,
            }, scene);
            t.isPickable = false;
            return t;
          };

          const core = makeTube('shotCore', coreRadius);
          const halo = makeTube('shotHalo', haloRadius);

          const coreMat = new BABYLON.StandardMaterial('shotCoreMat', scene);
          coreMat.emissiveColor = color.clone ? color.clone() : color;
          coreMat.diffuseColor = new BABYLON.Color3(color.r * 0.18, color.g * 0.18, color.b * 0.18);
          coreMat.specularColor = new BABYLON.Color3(0, 0, 0);
          coreMat.alpha = (wpn0 === 'sniper') ? 0.98 : 0.94;
          core.material = coreMat;

          const haloMat = new BABYLON.StandardMaterial('shotHaloMat', scene);
          haloMat.emissiveColor = new BABYLON.Color3(
            Math.min(1.0, color.r * 1.05),
            Math.min(1.0, color.g * 1.05),
            Math.min(1.0, color.b * 1.05)
          );
          haloMat.diffuseColor = new BABYLON.Color3(color.r * 0.08, color.g * 0.08, color.b * 0.08);
          haloMat.specularColor = new BABYLON.Color3(0, 0, 0);
          haloMat.alpha = (wpn0 === 'sniper') ? 0.38 : 0.32;
          halo.material = haloMat;

          // Keep strict "one tracer" policy by storing both meshes under the weapon key.
          try {
            if (!window.__lastTracerByWeapon) window.__lastTracerByWeapon = {};
            window.__lastTracerByWeapon[wpn0] = [core, halo];
          } catch {}

          // Keep tracers around long enough to reliably show up in iPhone captures
          // (our capture script screenshots ~90ms after firing).
          const ttl = (wpn0 === 'rifle') ? 260 : (wpn0 === 'minigun') ? 200 : (wpn0 === 'shotgun') ? 300 : (wpn0 === 'sniper') ? 380 : 260;

          // Quick fade so it feels like a velocity streak, not a laser.
          const fade = [
            [Math.max(20, Math.floor(ttl * 0.45)), 0.70],
            [Math.max(50, Math.floor(ttl * 0.72)), 0.38],
            [ttl, 0.0],
          ];
          for (const [ms, a] of fade) {
            setTimeout(() => {
              try {
                coreMat.alpha = ((wpn0 === 'sniper') ? 0.98 : 0.94) * a;
                haloMat.alpha = ((wpn0 === 'sniper') ? 0.38 : 0.32) * a;
              } catch {}
            }, ms);
          }
          setTimeout(() => {
            try { core.dispose(); } catch {}
            try { halo.dispose(); } catch {}
          }, ttl + 20);
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

      // ── Task #12: TANK hull impact sparks + clang ──
      // If we hit a tank player, show a bigger metallic spark flash and play a clang.
      // (Still client-side only; server damage/logic unchanged.)
      if (s.hit) {
        try {
          const hitId = String(s.hit);
          const st = window.__lastState;
          const victim = st && Array.isArray(st.players) ? st.players.find(p => String(p.id) === hitId) : null;
          if (victim && victim.vehicle === 'tank') {
            const raw = new BABYLON.Vector3(s.ex, (s.ey || (s.sy || 1.8) - 0.05), s.ez);
            // No world pick: we want the flash right on the "hit" point, not on nearby walls.
            const intensity = ((s.weapon || 'rifle') === 'tank' || (s.weapon || 'rifle') === 'rocket') ? 1.9 : 1.25;
            spawnTankHullSparks(raw, intensity);
            try {
              if (SFX && typeof SFX.tankClang === 'function') SFX.tankClang(intensity);
            } catch {}

            // If the hit actually DESTROYED the tank, play a much bigger destruction boom.
            // Task #13: TANK destruction
            try {
              const hp = (typeof s.hitHp === 'number') ? s.hitHp : null;
              if (hp !== null && hp <= 0) {
                spawnTankDestruction(raw, (s.weapon || 'rifle') === 'tank' ? 2.1 : 1.6);
              }
            } catch {}
          }
        } catch {}
      }

      // Bullet marks disabled (no dents). Keep sparks for misses/near-misses feedback.
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
              if (wpn !== 'rocket' && wpn !== 'tank' && !String(wpn).startsWith('grenade_') && wpn !== 'knife') spawnSparks(hit.p, wpn === 'shotgun' ? 0.8 : 1.0);
            }
          } else {
            const raw = new BABYLON.Vector3(s.ex, (s.ey || (s.sy || 1.8) - 0.2), s.ez);
            const hit = pickImpact(gunStart, raw);
            if (wpn !== 'rocket' && wpn !== 'tank' && !String(wpn).startsWith('grenade_') && wpn !== 'knife') spawnSparks(hit.p, wpn === 'shotgun' ? 0.8 : 1.0);
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
        // Some legacy/alt weapon ids can arrive (e.g. "pistol"); normalize FX to a known profile
        // so muzzle flash + recoil visuals always fire.
        const wpnFx = (RECOIL[wpn] && fpRig?.guns?.[wpn]) ? wpn : (RECOIL[wpn] ? wpn : 'rifle');
        const rc = RECOIL[wpnFx] || RECOIL.rifle;

        // Task #1: GUN recoil
        // Trigger the client-side recoil kick + spring recovery (viewmodel + reticle UI).
        // Keep this strictly visual (no aim perturbation).
        try {
          if (wpn !== 'knife' && typeof window.__hbApplyRecoil === 'function') {
            window.__hbApplyRecoil(wpnFx);
          }
        } catch {}

        if (wpn === 'knife') {
          // Knife: animate swing instead of muzzle flash/tracers.
          try {
            const k = fpRig?.guns?.knife;
            if (k) {
              k.metadata = k.metadata || {};
              k.metadata._stab = 1.0;
            }
          } catch {}
        } else if (wpn === 'tank') {
          // Task #10: TANK cannon blast
          // Make the cannon shot feel *huge*: bright fireball + expanding shockwave ring + warm light afterglow.
          if (fpRig?.muzzleFlash && fpRig._flashBaseSize) {
            fpRig.muzzleFlash.scaling.setAll(6.4);
            fpRig.muzzleFlash.isVisible = true;

            // UI flash overlay (guaranteed visible in a still iPhone screenshot)
            // This is part of the cannon blast feel: a brief hot flash + afterglow.
            try {
              const id = '__hbTankBlastFlash';
              let el = document.getElementById(id);
              if (!el) {
                el = document.createElement('div');
                el.id = id;
                el.style.position = 'fixed';
                el.style.left = '0';
                el.style.top = '0';
                el.style.right = '0';
                el.style.bottom = '0';
                el.style.zIndex = '99998';
                el.style.pointerEvents = 'none';
                el.style.opacity = '0';
                el.style.background = 'radial-gradient(circle at 50% 50%, rgba(255,205,120,0.70) 0%, rgba(255,140,60,0.35) 28%, rgba(0,0,0,0.0) 62%)';
                el.style.mixBlendMode = 'screen';
                document.body.appendChild(el);
              }
              // Cancel any in-flight fade.
              if (el._fadeT) { clearTimeout(el._fadeT); el._fadeT = null; }
              el.style.transition = 'none';
              el.style.opacity = '1';
              requestAnimationFrame(() => {
                el.style.transition = 'opacity 520ms ease-out';
                el.style.opacity = '0';
              });
              el._fadeT = setTimeout(() => { try { el.style.transition = 'none'; el.style.opacity = '0'; } catch {} }, 600);
            } catch {}

            // Spawn a short-lived shockwave ring so the blast reads clearly in 3D.
            try {
              const mpos = fpRig?.muzzleFlash?.getAbsolutePosition?.() || null;
              if (mpos && scene) {
                const ring = BABYLON.MeshBuilder.CreateTorus('tankShock', { diameter: 0.55, thickness: 0.08, tessellation: 64 }, scene);
                ring.position.copyFrom(mpos);
                ring.position.addInPlace(new BABYLON.Vector3(0, 0, 0.55));
                ring.rotation.x = Math.PI / 2;

                const mat = new BABYLON.StandardMaterial('tankShockMat', scene);
                mat.emissiveColor = new BABYLON.Color3(1.0, 0.82, 0.40);
                mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
                mat.specularColor = new BABYLON.Color3(0, 0, 0);
                mat.alpha = 0.95;
                ring.material = mat;

                const tStart = performance.now();
                const dur = 320;
                const tick = () => {
                  try {
                    const t = performance.now();
                    const a = Math.min(1, Math.max(0, (t - tStart) / dur));
                    const s = 0.8 + a * 9.0;
                    ring.scaling.setAll(s);
                    mat.alpha = (1 - a) * 0.95;
                    if (a >= 1) {
                      ring.dispose();
                      return;
                    }
                    requestAnimationFrame(tick);
                  } catch {
                    try { ring.dispose(); } catch {}
                  }
                };
                requestAnimationFrame(tick);
                setTimeout(() => { try { ring.dispose(); } catch {} }, dur + 160);
              }
            } catch {}

            try {
              if (fpRig?.muzzleLight) {
                fpRig.muzzleLight.diffuse = new BABYLON.Color3(1.0, 0.62, 0.20);
                fpRig.muzzleLight.range = 22;

                // Big pulse + warm afterglow.
                fpRig.muzzleLight.metadata = fpRig.muzzleLight.metadata || {};
                const token = (fpRig.muzzleLight.metadata._pulseToken = (Date.now() + Math.random()));
                const base = 8.0;
                fpRig.muzzleLight.intensity = base;
                const steps = [
                  [70,  base * 0.78],
                  [170, base * 0.52],
                  [320, base * 0.34],
                  [520, base * 0.20],
                  [760, base * 0.10],
                  [1100, 0.0],
                ];
                for (const [ms, v] of steps) {
                  setTimeout(() => {
                    try {
                      if (!fpRig?.muzzleLight) return;
                      if (fpRig.muzzleLight.metadata?._pulseToken !== token) return;
                      fpRig.muzzleLight.intensity = v;
                    } catch {}
                  }, ms);
                }
              }
            } catch {}

            applyRecoil('rocket');
            setTimeout(() => { try { if (fpRig?.muzzleFlash) fpRig.muzzleFlash.isVisible = false; } catch {} }, 300);
          }
        } else if (fpRig?.muzzleFlash && fpRig._flashBaseSize) {
          fpRig.muzzleFlash.scaling.setAll(rc.flashScale);
          fpRig.muzzleFlash.isVisible = true;
          try {
            if (fpRig?.muzzleLight) {
              // Weapon-specific light feel.
              const warm = (wpn === 'shotgun' || wpn === 'rocket')
                ? new BABYLON.Color3(1.0, 0.70, 0.22)
                : (wpn === 'sniper')
                  ? new BABYLON.Color3(1.0, 0.85, 0.35)
                  : new BABYLON.Color3(1.0, 0.92, 0.45);
              fpRig.muzzleLight.diffuse = warm;
              // Stronger base so the dynamic light actually reads on mobile.
              fpRig.muzzleLight.range = (wpn === 'shotgun') ? 16.0 : (wpn === 'sniper') ? 14.0 : (wpn === 'minigun') ? 12.0 : 14.0;
              fpRig.muzzleLight.intensity = (wpn === 'shotgun') ? 7.0 : (wpn === 'sniper') ? 6.0 : (wpn === 'minigun') ? 4.0 : 5.8;
            }
          } catch {}
          applyRecoil(wpnFx);
          // Task #3 (muzzle flash dynamic light): keep a *brief* warm afterglow so the
          // flash actually lights the scene on mobile captures (single-frame flashes
          // are easy to miss at 60fps, and our iPhone capture grabs a frame during reload).
          try {
            // (A) The actual dynamic light pulse (lights the scene).
            if (fpRig?.muzzleLight) {
              fpRig.muzzleLight.metadata = fpRig.muzzleLight.metadata || {};
              const token = (fpRig.muzzleLight.metadata._pulseToken = (Date.now() + Math.random()));
              // Stronger boost + longer tail so the light spill reads clearly on iPhone.
              // (Task #3: dynamic muzzle flash light)
              const base = (fpRig.muzzleLight.intensity || 2.0) * 1.85;
              fpRig.muzzleLight.intensity = base;
              // Keep it short enough to still feel like a flash, but long enough to be visible in a still capture.
              const steps = [
                [70,  base * 0.82],
                [170, base * 0.58],
                [320, base * 0.38],
                [520, base * 0.25],
                [760, base * 0.14],
                [1200, 0.0],
              ];
              for (const [ms, v] of steps) {
                setTimeout(() => {
                  try {
                    if (!fpRig?.muzzleLight) return;
                    if (fpRig.muzzleLight.metadata?._pulseToken !== token) return;
                    fpRig.muzzleLight.intensity = v;
                  } catch {}
                }, ms);
              }
            }

            // (B) Also warm-glow the viewmodel materials briefly so the muzzle light
            // is *obviously* reading in iPhone captures even if the scene is bright.
            const root = fpRig?.guns?.[wpnFx];
            if (root && root.getChildMeshes) {
              root.metadata = root.metadata || {};
              const token = (root.metadata._muzzleGlowToken = (Date.now() + Math.random()));
              const meshes = root.getChildMeshes(false);
              const touched = [];
              for (const m of meshes) {
                const mat = m?.material;
                if (!mat) continue;
                if (!('emissiveColor' in mat)) continue;
                const prev = mat.emissiveColor && mat.emissiveColor.clone ? mat.emissiveColor.clone() : null;
                // Warm flash tint.
                try { mat.emissiveColor = new BABYLON.Color3(0.9, 0.55, 0.15); } catch {}
                touched.push([mat, prev]);
              }
              const decay = [
                [120, new BABYLON.Color3(0.55, 0.28, 0.08)],
                [260, new BABYLON.Color3(0.28, 0.14, 0.04)],
                [520, null],
              ];
              for (const [ms, c] of decay) {
                setTimeout(() => {
                  try {
                    if (!fpRig?.guns?.[wpnFx]) return;
                    if (fpRig.guns[wpnFx].metadata?._muzzleGlowToken !== token) return;
                    for (const [mat, prev] of touched) {
                      if (!mat) continue;
                      if (c) mat.emissiveColor = c;
                      else if (prev) mat.emissiveColor = prev;
                      else mat.emissiveColor = new BABYLON.Color3(0,0,0);
                    }
                  } catch {}
                }, ms);
              }
            }
          } catch {}

          // Hold the muzzle flash sprite a bit longer so it's visible on iPhone
          // (single-frame flashes are easy to miss).
          setTimeout(() => {
            try { if (fpRig?.muzzleFlash) fpRig.muzzleFlash.isVisible = false; } catch {}
          }, 220);
        }
        if (wpn === 'rocket') { try { SFX.whoosh(); } catch {} }
        else if (wpn === 'knife') { /* no gun sound */ }
        else if (wpn === 'fishing_pole') { try { SFX.cast(); } catch {} }
        else if (wpn === 'tank') { try { SFX.cannon(); } catch {} }
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

