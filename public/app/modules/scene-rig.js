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

