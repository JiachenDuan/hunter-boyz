
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

