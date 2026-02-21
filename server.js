const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');

// Shared weapon definitions (UMD module in public/weapons.js)
const { WEAPONS, getWeapon } = require('./public/weapons.js');

const PORT = process.env.PORT || 3030;

const app = express();
// Prevent iOS/Chrome from caching old JS during rapid iteration.
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});
// Also version static assets so clients *must* fetch the latest.
app.use((req, res, next) => {
  if (req.url.startsWith('/index.html?v=')) req.url = '/index.html';
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
// Serve saved snapshots
app.use('/snaps', express.static(path.join(__dirname, 'snaps')));

// Redirect root to a cache-busting URL so iOS doesn't reuse a stale HTML.
app.get('/', (req, res) => res.redirect(302, `/index.html?v=${Date.now()}`));

// Debug endpoints (localhost only) to support automated screenshots.
function isLocalReq(req) {
  const ip = (req.ip || req.connection?.remoteAddress || '').toString();
  return ip.includes('127.0.0.1') || ip.includes('::1') || ip.includes('::ffff:127.0.0.1');
}

app.post('/debug/start', (req, res) => {
  if (!isLocalReq(req)) return res.status(403).send('forbidden');
  GAME.started = true;
  broadcast({ t: 'state', state: serializeState() });
  res.json({ ok: true });
});

app.post('/debug/teleport', express.json(), (req, res) => {
  if (!isLocalReq(req)) return res.status(403).send('forbidden');
  const { id, x, y, z, yaw, pitch, hp } = req.body || {};
  const p = players.get(String(id));
  if (!p) return res.status(404).json({ ok: false, error: 'no-player' });
  if (typeof x === 'number') p.x = x;
  if (typeof y === 'number') p.y = y;
  if (typeof z === 'number') p.z = z;
  if (typeof yaw === 'number') p.yaw = yaw;
  if (typeof pitch === 'number') p.pitch = pitch;
  if (typeof hp === 'number') p.hp = Math.max(0, Math.min(100, hp));
  broadcast({ t: 'state', state: serializeState() });
  res.json({ ok: true });
});

app.post('/debug/shoot', express.json(), (req, res) => {
  if (!isLocalReq(req)) return res.status(403).send('forbidden');
  const { fromId } = req.body || {};
  const shooter = players.get(String(fromId));
  if (!shooter) return res.status(404).json({ ok: false, error: 'no-shooter' });
  if (!GAME.started) GAME.started = true;
  if (shooter.hp <= 0) return res.json({ ok: false, error: 'dead' });

  const hit = rayHit(shooter);
  const target = hit.target;

  let hitId = null;
  let hitHp = null;
  if (target && target.hp > 0) {
    target.hp -= 25;
    if (target.hp <= 0) {
      target.hp = 0;
      target.respawnAt = nowMs() + 2000;
      shooter.score += 1;
    }
    hitId = target.id;
    hitHp = target.hp;
  }

  broadcast({
    t: 'shot',
    from: shooter.id,
    sx: shooter.x,
    sy: shooter.y,
    sz: shooter.z,
    ex: hit.endX,
    ey: shooter.y,
    ez: hit.endZ,
    hit: hitId,
    hitHp,
  });

  broadcast({ t: 'state', state: serializeState() });
  res.json({ ok: true, hit: hitId, hitHp });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/**
 * Very small MVP protocol (JSON):
 * client -> server:
 *  - {t:'join', name}
 *  - {t:'input', seq, dt, move:{x,z}, look:{yaw,pitch}, shoot:boolean}
 * server -> client:
 *  - {t:'welcome', id, state}
 *  - {t:'state', state}
 */

const TICK_HZ = 15;
const MAPS = {
  arena: {
    id: 'arena',
    label: 'Arena (Default)',
    bounds: { minX: -25, maxX: 25, minZ: -25, maxZ: 25 },
    spawnPoints: [
      { x: -10, y: 1.8, z: -10 },
      { x: 10, y: 1.8, z: -10 },
      { x: 0, y: 1.8, z: 12 },
    ],
    obstacles: [
      { x: 0, y: 1.5, z: 0, w: 3, h: 3, d: 3 },
      { x: -8, y: 1, z: 6, w: 4, h: 2, d: 6 },
      { x: 10, y: 1.5, z: -6, w: 6, h: 3, d: 3 },
    ],
    pickupPads: [
      { id: 'pad_mg_1', type: 'minigun', x: 0, y: 1.8, z: 0 },
      { id: 'pad_mg_2', type: 'minigun', x: -12, y: 1.8, z: 10 },
    ],
  },
  mansion: {
    id: 'mansion',
    label: 'Mansion (CS style)',
    bounds: { minX: -25, maxX: 25, minZ: -25, maxZ: 25 },
    spawnPoints: [
      // Attack-side spawns: outside the main gate (north)
      // NOTE: keep these outside the north wall segment at z=-23 (depth=2 spans z∈[-24,-22]).
      // Otherwise players can spawn intersecting the wall and get "stuck"/jittery.
      // Slightly past the collision-expanded wall edge (radius=0.7) so spawns never intersect.
      { x: -3.5, y: 1.8, z: -24.85 },
      { x: 3.5, y: 1.8, z: -24.85 },
      { x: -1.5, y: 1.8, z: -24.3 },
      { x: 1.5, y: 1.8, z: -24.3 },

      // Mid-map spawns: reduce repeat spawn-trading at the north gate and spread fights out.
      // (All positions avoid perimeter walls at x=±23 / z=±23 and the facade wall at z=-6.)
      { x: -10.0, y: 1.8, z: -10.0 },
      { x: 10.0, y: 1.8, z: -10.0 },
      // Interior/back spawns: give a "reset" option and keep late-round flow moving.
      { x: -6.0, y: 1.8, z: 14.0 },
      { x: 6.0, y: 1.8, z: 14.0 },
      // South yard spawn (inside bounds, outside the south wall thickness)
      { x: 0.0, y: 1.8, z: 21.0 },
    ],
    // Mansion v2 (ultra-lite): ~50% fewer obstacles again + a few jump-up props.
    // Goal: cleaner readability, less clutter, but still has: perimeter → courtyard → door choke → interior.
    // Jump props are low boxes (h~1.15) you can mantle/jump onto.
    obstacles: [
      // Perimeter + main gate gap (north)
      { x: -14.5, y: 0, z: -23, w: 19, h: 4.6, d: 2 },
      { x: 14.5, y: 0, z: -23, w: 19, h: 4.6, d: 2 },
      { x: -23, y: 0, z: 0, w: 2, h: 4.6, d: 46 },
      { x: 23, y: 0, z: 0, w: 2, h: 4.6, d: 46 },
      { x: 0, y: 0, z: 23, w: 46, h: 4.6, d: 2 },

      // Drained pool (very simple: two low rims)
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

      // Interior: just the back wall (super readable)
      { x: 0, y: 0, z: 10.5, w: 22, h: 4.6, d: 2 },

      // Jump-up props (low cover + movement options)
      { x: -2.0, y: 0, z: -18.0, w: 2.4, h: 1.15, d: 2.4 },
      { x: 2.0, y: 0, z: -18.0, w: 2.4, h: 1.15, d: 2.4 },
      { x: -8.0, y: 0, z: -11.0, w: 2.2, h: 1.15, d: 2.2 },
      // Nudge away from the facade wall at z=-6 to avoid overlapping collision/visual clutter.
      { x: 2.0, y: 0, z: -9.0, w: 2.2, h: 1.15, d: 2.2 },

      // Courtyard-right "sniper tower" (climb via jump-steps)
      // Placement logic: right-side has strong courtyard/door sight, but the climb is exposed.
      { x: 17.6, y: 0, z: -17.0, w: 2.6, h: 0.95, d: 2.6 }, // Step 1
      { x: 18.6, y: 0, z: -15.6, w: 2.2, h: 1.20, d: 2.2 }, // Step 2
      { x: 19.2, y: 0, z: -13.6, w: 3.2, h: 1.55, d: 3.2 }, // Top platform
      { x: 21.1, y: 0, z: -13.6, w: 1.0, h: 3.6, d: 4.6 },  // Backboard (limits 360° + provides partial cover)
      { x: 19.2, y: 0, z: -11.6, w: 2.2, h: 1.0, d: 0.9 },   // Low rail (prevents easy straight-on trades)

    ],
    pickupPads: [
      { id: 'pad_mg_1', type: 'minigun', x: -9, y: 1.8, z: 12 },
      { id: 'pad_mg_2', type: 'minigun', x: 9, y: 1.8, z: 12 },
    ],
  },
};

const BUILD = String(Date.now());
const WIN_SCORE = 8;
const ROUND_MS = 90_000;
const AFK_MS = 60_000;

const GAME = {
  started: false,
  hostId: null,
  roundOverAt: 0,
  roundEndsAt: 0,
  mapId: 'arena',
  firstBlood: false,
};

let nextId = 1;
const clients = new Map(); // ws -> playerId
const players = new Map(); // id -> player state


// Server-simulated grenades
const grenades = []; // {id, kind, ownerId, x,y,z, vx,vy,vz, bornAt, fuseAt, armAt, exploded}
let nextGrenadeId = 1;

// Pickup system (currently: minigun)
const pickupPads = [
  { id: 'pad_mg_1', type: 'minigun', x: 0, y: 1.8, z: 0, respawnAt: 0, heldBy: null },
  { id: 'pad_mg_2', type: 'minigun', x: -12, y: 1.8, z: 10, respawnAt: 0, heldBy: null },
];
let minigunDrop = null; // {x,y,z, expiresAt}


// Connection/session management to prevent duplicate players on reconnect.
const playerConn = new Map(); // playerId -> ws
const clientToPlayer = new Map(); // clientId -> playerId

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function nowMs() { return Date.now(); }
function getActiveMap() { return MAPS[GAME.mapId] || MAPS.arena; }
function applyMapConfig(mapId) {
  const map = MAPS[mapId] || MAPS.arena;
  GAME.mapId = map.id;

  for (const p of pickupPads) {
    p.heldBy = null;
    p.respawnAt = 0;
  }
  const pads = map.pickupPads || [];
  for (let i = 0; i < pickupPads.length; i++) {
    const src = pads[i] || pads[0];
    if (!src) continue;
    pickupPads[i].id = src.id || pickupPads[i].id;
    pickupPads[i].type = src.type || 'minigun';
    pickupPads[i].x = src.x;
    pickupPads[i].y = src.y;
    pickupPads[i].z = src.z;
  }
  minigunDrop = null;
}
applyMapConfig(GAME.mapId);

function makePlayer(name) {
  const id = String(nextId++);
  const world = getActiveMap();
  const sp = world.spawnPoints[(Number(id) - 1) % world.spawnPoints.length];
  const hue = (Number(id) * 137) % 360;
  return {
    id,
    name: (name || 'Hunter').slice(0, 16),
    x: sp.x,
    y: sp.y,
    z: sp.z,
    vy: 0,
    yaw: 0,
    pitch: 0,
    hp: 100,
    score: 0,
    deaths: 0,
    lastShotAt: 0,
    lastInputAt: nowMs(),
    respawnAt: 0,
    invulnUntil: 0,
    ammo: 12,
    reloadUntil: 0,
    autoReload: true,
    disconnectedAt: 0,
    fartUntil: 0,
    fartTickAt: 0,

    // Power weapon (pickup-only)
    powerWeapon: null,
    powerAmmo: 0,
    mgSpin: 0,
    mgHeat: 0,
    mgOverheat: 0,

    color: `hsl(${hue} 80% 60%)`,
  };
}

function serializeState() {
  return {
    ts: nowMs(),
    build: BUILD,
    game: { started: GAME.started, hostId: GAME.started ? GAME.hostId : GAME.hostId, roundEndsAt: GAME.roundEndsAt, mapId: GAME.mapId },
    pickups: serializePickups(),
    players: Array.from(players.values()).map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: p.yaw,
      pitch: p.pitch,
      hp: p.hp,
      score: p.score,
      deaths: p.deaths,
      ammo: p.ammo,
      powerWeapon: p.powerWeapon || null,
      powerAmmo: p.powerAmmo || 0,
      mgSpin: p.mgSpin || 0,
      mgHeat: p.mgHeat || 0,
      mgOverheat: p.mgOverheat || 0,
      reloadInMs: Math.max(0, p.reloadUntil - nowMs()),
      invulnInMs: Math.max(0, p.invulnUntil - nowMs()),
      respawnInMs: p.hp > 0 ? 0 : Math.max(0, p.respawnAt - nowMs()),
      connected: playerConn.has(p.id),
      fartInMs: Math.max(0, (p.fartUntil || 0) - nowMs()),
      color: p.color,
    })),
  };
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function respawn(p) {
  const world = getActiveMap();
  // Prefer spawns away from other alive players to reduce instant spawn-kills.
  let sp = null;
  try {
    const sps = world.spawnPoints || [];
    for (let tries = 0; tries < 8; tries++) {
      const cand = sps[Math.floor(Math.random() * sps.length)];
      if (!cand) continue;
      let minD = Infinity;
      for (const other of players.values()) {
        if (other.id === p.id) continue;
        if (other.hp <= 0) continue;
        const d = Math.hypot((other.x - cand.x), (other.z - cand.z));
        if (d < minD) minD = d;
      }
      if (minD >= 10) { sp = cand; break; }
      // keep best-so-far
      if (!sp || minD > sp._minD) { sp = Object.assign({ _minD: minD }, cand); }
    }
    if (sp && sp._minD != null) delete sp._minD;
  } catch {}
  if (!sp) sp = world.spawnPoints[Math.floor(Math.random() * world.spawnPoints.length)];
  p.x = sp.x; p.y = sp.y; p.z = sp.z;
  p.vy = 0;
  p.hp = 100;
  p.respawnAt = 0;
  p.invulnUntil = nowMs() + 1000;
  p.ammo = 12;
  p.reloadUntil = 0;
  p.fartUntil = 0;
  p.fartTickAt = 0;
  p.disconnectedAt = 0;
  // Release any pickup pad this player was holding so pad becomes available again
  const t = nowMs();
  for (const pad of pickupPads) {
    if (pad.heldBy === p.id) {
      pad.heldBy = null;
      pad.respawnAt = t + 15_000;
    }
  }
}

function rayHit(shooter, maxDist = 30, yawOverride = null) {
  // Simple hitscan in XZ plane + pitch ignored (used by rifle/shotgun).
  const yaw = (typeof yawOverride === 'number') ? yawOverride : shooter.yaw;
  const dirX = Math.sin(yaw);
  const dirZ = Math.cos(yaw);

  let best = null;
  for (const p of players.values()) {
    if (p.id === shooter.id) continue;
    if (p.hp <= 0) continue;

    const vx = p.x - shooter.x;
    const vz = p.z - shooter.z;
    const proj = vx * dirX + vz * dirZ;
    if (proj < 0 || proj > maxDist) continue;

    // perpendicular distance to ray
    const perpX = vx - proj * dirX;
    const perpZ = vz - proj * dirZ;
    const d2 = perpX * perpX + perpZ * perpZ;

    // hit radius ~ player body
    const r = 0.9;
    if (d2 <= r * r) {
      if (!best || proj < best.proj) best = { target: p, proj };
    }
  }
  if (!best) return { target: null, endX: shooter.x + dirX * maxDist, endZ: shooter.z + dirZ * maxDist };
  return { target: best.target, endX: shooter.x + dirX * best.proj, endZ: shooter.z + dirZ * best.proj };
}

function rayHit3D(shooter, maxDist = 80) {
  // 3D hitscan using yaw + pitch.
  // Convention: in our client, pitch increases when dragging finger downward (look down).
  const yaw = shooter.yaw;
  const pitch = shooter.pitch || 0;
  const cosP = Math.cos(pitch);

  const dirX = Math.sin(yaw) * cosP;
  const dirZ = Math.cos(yaw) * cosP;
  const dirY = -Math.sin(pitch);

  // Normalize (close enough; but do it anyway)
  const len = Math.hypot(dirX, dirY, dirZ) || 1;
  const dx = dirX / len;
  const dy = dirY / len;
  const dz = dirZ / len;

  let best = null; // { target, t, part }

  for (const p of players.values()) {
    if (p.id === shooter.id) continue;
    if (p.hp <= 0) continue;

    // Two-sphere approximation: head + body.
    // Player eye height is ~1.8; client model head center ends up around y+0.75.
    const head = { x: p.x, y: (p.y || 1.8) + 0.75, z: p.z, r: 0.35, part: 'head' };
    const body = { x: p.x, y: (p.y || 1.8) + 0.15, z: p.z, r: 0.75, part: 'body' };

    for (const s of [head, body]) {
      const vx = s.x - shooter.x;
      const vy = s.y - shooter.y;
      const vz = s.z - shooter.z;

      const t = vx * dx + vy * dy + vz * dz; // projection onto ray
      if (t < 0 || t > maxDist) continue;

      const px = vx - t * dx;
      const py = vy - t * dy;
      const pz = vz - t * dz;
      const d2 = px*px + py*py + pz*pz;

      if (d2 <= s.r * s.r) {
        if (!best || t < best.t || (t === best.t && s.part === 'head')) {
          best = { target: p, t, part: s.part };
        }
      }
    }
  }

  if (!best) {
    return {
      target: null,
      part: null,
      endX: shooter.x + dx * maxDist,
      endY: shooter.y + dy * maxDist,
      endZ: shooter.z + dz * maxDist,
    };
  }

  return {
    target: best.target,
    part: best.part,
    endX: shooter.x + dx * best.t,
    endY: shooter.y + dy * best.t,
    endZ: shooter.z + dz * best.t,
  };
}

function doDamage({ shooter, target, amount }) {
  const t = nowMs();
  if (!target || target.hp <= 0) return { hitId: null, hitHp: null, killed: false };
  if (t < (target.invulnUntil || 0)) return { hitId: null, hitHp: null, killed: false };

  // 1HP clutch: if you're above 0 and this hit would kill you, there's a small chance to survive at 1 HP.
  // Adds party-game chaos moments without changing average TTK too much.
  try {
    if (target.hp > 1 && (target.hp - amount) <= 0) {
      if (Math.random() < 0.12) {
        target.hp = 1;
        broadcast({ t:'toast', kind:'clutch', id: target.id });
        return { hitId: target.id, hitHp: target.hp, killed: false };
      }
    }
  } catch {}

  target.hp -= amount;
  if (target.hp <= 0) {
    target.hp = 0;
    target.respawnAt = t + 2000;
    target.deaths = (target.deaths || 0) + 1;

    // Drop power weapon on death (minigun) for 8s.
    if (target.powerWeapon === 'minigun' && (target.powerAmmo||0) > 0) {
      minigunDrop = { x: target.x, y: target.y, z: target.z, expiresAt: t + 8000 };
      // clear ownership from pads
      for (const pad of pickupPads) if (pad.heldBy === target.id) { pad.heldBy = null; pad.respawnAt = t + 30_000; }
      target.powerWeapon = null;
      target.powerAmmo = 0;
      target.mgSpin = 0;
      target.mgHeat = 0;
      target.mgOverheat = 0;
    }

    if (shooter) {
      shooter.score += 1;

      // Party-game spice: tiny kill bonus for multi-kills in a short window.
      // Keeps stakes high without changing weapon balance.
      try {
        const winMs = 4200;
        const last = shooter._lastKillAt || 0;
        const within = (t - last) <= winMs;
        shooter._streak = within ? ((shooter._streak || 0) + 1) : 1;
        shooter._lastKillAt = t;
        if (shooter._streak >= 2) {
          shooter.score += 1; // bonus point
          broadcast({ t: 'toast', kind: 'streak', id: shooter.id, n: shooter._streak, bonus: 1 });
        }
      } catch {}

      // First blood bonus: first kill of the round is worth +1.
      try {
        if (GAME.started && !GAME.roundOverAt && !GAME.firstBlood) {
          GAME.firstBlood = true;
          shooter.score += 1;
          broadcast({ t: 'toast', kind: 'firstblood', id: shooter.id, bonus: 1 });
        }
      } catch {}

      // Revenge bonus: if you kill the player who killed you last, +1.
      try {
        if (shooter._lastKilledBy && String(shooter._lastKilledBy) === String(target.id)) {
          shooter.score += 1;
          broadcast({ t: 'toast', kind: 'revenge', id: shooter.id, against: target.id, bonus: 1 });
        }
      } catch {}

      // Track last killer (for revenge)
      try { target._lastKilledBy = shooter.id; } catch {}

      broadcast({ t: 'kill', killer: shooter.id, killerName: shooter.name, victim: target.id, victimName: target.name });
    } else {
      broadcast({ t: 'kill', killer: null, killerName: '—', victim: target.id, victimName: target.name });
    }

    // First-to-8 wins the round (faster, more chaotic rounds)
    if (!GAME.roundOverAt && shooter && shooter.score >= WIN_SCORE) {
      GAME.roundOverAt = t;
      broadcast({ t: 'winner', winnerId: shooter.id, winnerName: shooter.name });

      // After 3s, reset scores + respawn all + return to lobby (faster loop)
      setTimeout(() => {
        try {
          for (const p of players.values()) {
            p.score = 0;
            p.deaths = 0;
            respawn(p);
          }
          GAME.started = false;
          GAME.roundOverAt = 0;
          GAME.roundEndsAt = 0;
          GAME.firstBlood = false;
          broadcast({ t: 'state', state: serializeState() });
        } catch {}
      }, 3000);
    }

    return { hitId: target.id, hitHp: target.hp, killed: true };
  }
  return { hitId: target.id, hitHp: target.hp, killed: false };
}

function dist2D(a, b) {
  const dx = (a.x - b.x);
  const dz = (a.z - b.z);
  return Math.hypot(dx, dz);
}


function serializePickups() {
  const t = nowMs();
  const items = [];
  for (const pad of pickupPads) {
    const availInMs = Math.max(0, (pad.respawnAt || 0) - t);
    items.push({ id: pad.id, type: pad.type, x: pad.x, y: pad.y, z: pad.z, kind: 'pad', availInMs, heldBy: pad.heldBy || null });
  }
  if (minigunDrop) {
    items.push({ id: 'drop_minigun', type: 'minigun', kind: 'drop', x: minigunDrop.x, y: minigunDrop.y, z: minigunDrop.z, availInMs: 0, expiresInMs: Math.max(0, (minigunDrop.expiresAt||0) - t) });
  }
  return items;
}

function spawnGrenade({ kind, ownerId, x, y, z, yaw, pitch, now }) {
  const gDef = getWeapon(kind);
  const id = String(nextGrenadeId++);
  // Throw direction (slight upward bias)
  const dirX = Math.sin(yaw) * Math.cos(pitch);
  const dirY = Math.sin(pitch);
  const dirZ = Math.cos(yaw) * Math.cos(pitch);

  const speed = 16;
  const vx = dirX * speed;
  const vy = (dirY * speed) + 3.5;
  const vz = dirZ * speed;

  grenades.push({
    id,
    kind,
    ownerId,
    x, y, z,
    vx, vy, vz,
    bornAt: now,
    fuseAt: now + (gDef.fuseMs || 1200),
    armAt: now + (gDef.armMs || 0),
    exploded: false,
  });
  broadcast({ t: 'grenadeSpawn', id, kind, ownerId, x, y, z, vx, vy, vz, fuseAt: now + (gDef.fuseMs || 1200), armAt: now + (gDef.armMs || 0) });
}

function explodeGrenade(g, ex, ey, ez) {
  const gDef = getWeapon(g.kind);
  const R = gDef.splashR || 6;
  const maxD = gDef.dmgMax || 100;
  const minD = gDef.dmgMin || 0;

  // Apply radial damage
  for (const tP of players.values()) {
    if (tP.hp <= 0) continue;
    if (tP.id === g.ownerId) {
      // allow self damage; keep it but slightly reduced for fun
    }
    const dx = tP.x - ex;
    const dy = (tP.y || 1.8) - ey;
    const dz = tP.z - ez;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > R) continue;
    const tt = Math.min(1, Math.max(0, dist / R));
    const amt = Math.round(maxD + (minD - maxD) * tt);
    if (amt <= 0) continue;
    doDamage({ shooter: players.get(g.ownerId) || null, target: tP, amount: amt });
  }

  broadcast({ t: 'explosion', kind: 'grenade', x: ex, y: ey, z: ez, r: R });
}

function damageFalloff(base, dist, { near = 4, far = 30, minMult = 0.45 } = {}) {
  if (dist <= near) return base;
  if (dist >= far) return Math.max(1, Math.round(base * minMult));
  const t = (dist - near) / (far - near);
  const mult = 1 - t * (1 - minMult);
  return Math.max(1, Math.round(base * mult));
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.lastMsgAt = nowMs();
  ws.on('pong', () => { ws.isAlive = true; ws.lastMsgAt = nowMs(); });

  ws.on('message', (buf) => {
    ws.lastMsgAt = nowMs();
    let msg;
    try { msg = JSON.parse(buf.toString('utf8')); } catch { return; }

    if (msg.t === 'join') {
      const clientId = (msg.clientId && String(msg.clientId).slice(0, 64)) || null;

      // If this clientId has an existing player, treat this as a reconnect and reuse that player.
      let p = null;
      if (clientId && clientToPlayer.has(clientId)) {
        const existingId = clientToPlayer.get(clientId);
        const existingP = players.get(existingId);
        if (existingP) {
          p = existingP;
          // Update name on reconnect (optional)
          if (msg.name) p.name = String(msg.name).slice(0, 16);

          // Kick/close previous connection for this player (if any)
          const oldWs = playerConn.get(existingId);
          if (oldWs && oldWs !== ws) {
            try { oldWs.terminate(); } catch {}
            clients.delete(oldWs);
          }

          clients.set(ws, existingId);
          playerConn.set(existingId, ws);

          ws.send(JSON.stringify({ t: 'welcome', id: existingId, state: serializeState(), world: getActiveMap() }));
          broadcast({ t: 'state', state: serializeState() });
          return;
        } else {
          // stale mapping
          clientToPlayer.delete(clientId);
        }
      }

      // Fresh join
      p = makePlayer(msg.name);
      clients.set(ws, p.id);
      players.set(p.id, p);
      playerConn.set(p.id, ws);
      if (clientId) clientToPlayer.set(clientId, p.id);

      if (!GAME.hostId) GAME.hostId = p.id;

      ws.send(JSON.stringify({ t: 'welcome', id: p.id, state: serializeState(), world: getActiveMap() }));
      broadcast({ t: 'state', state: serializeState() });
      return;
    }

    const id = clients.get(ws);
    if (!id) return;
    const p = players.get(id);
    if (!p) return;

    if (msg.t === 'start') {
      // Anyone can start (LAN party vibe).
      GAME.started = true;
      GAME.roundOverAt = 0;
      GAME.roundEndsAt = nowMs() + ROUND_MS;
      GAME.firstBlood = false;
      broadcast({ t: 'state', state: serializeState() });
      return;
    }

    if (msg.t === 'setMap') {
      if (GAME.started) return;
      const nextMap = String(msg.mapId || '');
      if (!MAPS[nextMap]) return;
      applyMapConfig(nextMap);
      for (const pp of players.values()) respawn(pp);
      broadcast({ t: 'state', state: serializeState() });
      return;
    }

    if (msg.t === 'resetLobby') {
      // Kick all other players + reset the match.
      for (const otherWs of wss.clients) {
        if (otherWs !== ws) {
          try { otherWs.terminate(); } catch {}
        }
      }

      // Keep only this player.
      for (const pid of Array.from(players.keys())) {
        if (pid !== id) {
          players.delete(pid);
          playerConn.delete(pid);
        }
      }

      // Clear clientId mappings pointing at removed players.
      for (const [cid, pid] of Array.from(clientToPlayer.entries())) {
        if (pid !== id) clientToPlayer.delete(cid);
      }

      // Make this player the host and reset the game.
      GAME.hostId = id;
      GAME.started = false;

      broadcast({ t: 'state', state: serializeState() });
      return;
    }

    if (msg.t === 'reload') {
      if (!GAME.started) return;
      if (p.hp <= 0) return;
      const t = nowMs();
      if (t < p.reloadUntil) return;
      if (p.ammo >= 12) return;
      p.reloadUntil = t + 900;

      // Arcade juice: play a reload sound for the reloader (and nearby players).
      try {
        broadcast({ t:'sfx', kind:'reload', x:p.x, y:p.y, z:p.z, id: p.id });
      } catch {}
      return;
    }

    if (msg.t === 'snap') {
      // Client can send a canvas snapshot (data URL). We'll store it and (optionally) notify.
      try {
        const fs = require('fs');
        const snapDir = path.join(__dirname, 'snaps');
        if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true });
        const dataUrl = String(msg.dataUrl || '');
        const m = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
        if (!m) return;
        const ext = m[1] === 'jpeg' ? 'jpg' : 'png';
        const b64 = m[2];
        const buf = Buffer.from(b64, 'base64');
        const ts = Date.now();
        const file = path.join(snapDir, `snap-${ts}-${id}.${ext}`);
        fs.writeFileSync(file, buf);
        ws.send(JSON.stringify({ t: 'snapSaved', file: path.basename(file) }));
      } catch {}
      return;
    }

    
    if (msg.t === 'dropMinigun') {
      if (p.powerWeapon !== 'minigun') return;
      const t = nowMs();
      // Clear player's minigun
      p.powerWeapon = null;
      p.powerAmmo = 0;
      p.mgSpin = 0;
      p.mgHeat = 0;
      p.mgOverheat = 0;
      // Release any pad they were holding
      for (const pad of pickupPads) {
        if (pad.heldBy === p.id) {
          pad.heldBy = null;
          pad.respawnAt = t + 30_000; // pad respawns in 30s
        }
      }
      // Spawn a drop pickup at player's location so others can grab it
      minigunDrop = { x: p.x, y: p.y, z: p.z, expiresAt: t + 15_000 };
      broadcast({ t: 'state', state: serializeState() });
      return;
    }

    if (msg.t === 'pickup') {
      if (!GAME.started) return;
      if (p.hp <= 0) return;
      const t = nowMs();

      const which = String(msg.id || '');

      function grantMinigun() {
        p.powerWeapon = 'minigun';
        p.powerAmmo = getWeapon('minigun').ammo || 300;
        p.mgSpin = 0;
        p.mgHeat = 0;
        p.mgOverheat = 0;
      }

      // Pick up from drop first
      if (which === 'drop_minigun' && minigunDrop) {
        const d = Math.hypot((p.x - minigunDrop.x), (p.z - minigunDrop.z));
        if (d <= 2.2 && t < (minigunDrop.expiresAt||0)) {
          minigunDrop = null;
          grantMinigun();
          broadcast({ t:'pickup', id: p.id, what: 'minigun' });
          broadcast({ t:'state', state: serializeState() });
        }
        return;
      }

      const pad = pickupPads.find(pp => pp.id === which);
      if (!pad) return;

      // must be near
      const d = Math.hypot((p.x - pad.x), (p.z - pad.z));
      if (d > 2.5) return;

      if ((pad.respawnAt || 0) > t) return;
      if (pad.heldBy) return;

      pad.heldBy = p.id;
      grantMinigun();
      broadcast({ t:'pickup', id: p.id, what: pad.type });
      broadcast({ t:'state', state: serializeState() });
      return;
    }

if (msg.t === 'input') {
      // Ignore gameplay until host starts.
      if (!GAME.started) return;

      // Prevent AFK cleanup from kicking active players.
      p.lastInputAt = nowMs();

      // Per-player settings
      if (typeof msg.autoReload === 'boolean') p.autoReload = msg.autoReload;

      // Dead players can't move/shoot.
      if (p.hp <= 0) return;

      const dt = clamp(Number(msg.dt || 0.05), 0, 0.2);
      const mv = msg.move || { x: 0, z: 0 };
      const wantSprint = !!msg.sprint;
      const baseSpeed = 8;
      const speed = wantSprint ? 11.5 : baseSpeed; // units/sec

      // movement in camera yaw space
      const yaw = Number(msg.look?.yaw ?? p.yaw);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);

      const fwdX = sin;
      const fwdZ = cos;
      const rightX = cos;
      const rightZ = -sin;

      const mx = clamp(Number(mv.x || 0), -1, 1);
      const mz = clamp(Number(mv.z || 0), -1, 1);

      // collision (simple capsule in XZ)
      const radius = 0.7;
      const nextX = p.x + (rightX * mx + fwdX * mz) * speed * dt;
      const nextZ = p.z + (rightZ * mx + fwdZ * mz) * speed * dt;

      const world = getActiveMap();
      function collides(x, z) {
        for (const o of world.obstacles) {
          const minX = o.x - o.w/2 - radius;
          const maxX = o.x + o.w/2 + radius;
          const minZ = o.z - o.d/2 - radius;
          const maxZ = o.z + o.d/2 + radius;
          if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return true;
        }
        return false;
      }

      // try x, then z (axis-separable)
      let xTry = clamp(nextX, world.bounds.minX, world.bounds.maxX);
      let zTry = clamp(nextZ, world.bounds.minZ, world.bounds.maxZ);

      if (!collides(xTry, p.z)) p.x = xTry;
      if (!collides(p.x, zTry)) p.z = zTry;

      // look
      p.yaw = yaw;
      p.pitch = clamp(Number(msg.look?.pitch ?? p.pitch), -1.2, 1.2);

      // jump/gravity
      const groundY = 1.8;
      const gravity = -18;
      const jumpV = 7.5;
      const wantJump = !!msg.jump;
      const onGround = p.y <= groundY + 1e-3;
      if (wantJump && onGround) p.vy = jumpV;
      p.vy += gravity * dt;
      p.y += p.vy * dt;
      if (p.y < groundY) { p.y = groundY; p.vy = 0; }

      // resolve reload completion
      {
        const t = nowMs();
        if (p.reloadUntil && t >= p.reloadUntil) {
          p.ammo = 12;
          p.reloadUntil = 0;
        }
      }

      // shoot
      if (msg.shoot) {
        const t = nowMs();
        let weapon = getWeapon((msg.weapon || 'rifle')).id;
        // Pickup-only power weapon override
        if (p.powerWeapon === 'minigun') weapon = 'minigun';

        // Minigun spin-up/down must update every input tick regardless of fire cooldown.
        // If we put spin inside the fireCdMs gate, lastShotAt gets set on first entry,
        // then the gate blocks every subsequent tick, and spin never builds up.
        if (p.powerWeapon === 'minigun') {
          const mDefSpin = getWeapon('minigun');
          const dtSec = Math.max(0.001, Math.min(0.25, Number(msg.dt || 0.066)));
          p.mgSpin = clamp((p.mgSpin||0) + (mDefSpin.spinUpPerSec||3.0) * dtSec, 0, 1);
          p.mgHeat = clamp((p.mgHeat||0) - (mDefSpin.coolPerSec||0.55) * dtSec, 0, 1);
          if (p.mgOverheat && (p.mgHeat||0) <= (mDefSpin.recoverAt||0.35)) p.mgOverheat = 0;
        }

        const wDef = getWeapon(weapon);
        const fireCdMs = (wDef && wDef.fireCdMs) ? wDef.fireCdMs : 250;

        if (t - p.lastShotAt > fireCdMs) {
          // can't shoot while reloading
          if (t < p.reloadUntil) return;

          // Auto-reload (optional)
          if ((wDef && typeof wDef.mag === 'number') && p.ammo <= 0) {
            if (p.autoReload) {
              p.reloadUntil = t + 900;
            }
            return;
          }

          p.lastShotAt = t;

          // Ammo model: only apply mag ammo for classic guns; melee/grenades/power weapons use custom logic.
          if (wDef && typeof wDef.mag === 'number') {
            p.ammo -= 1;
          }

          let hitId = null;
          let hitHp = null;

          // Knife melee (server-authoritative)
          if (weapon === 'knife') {
            const kDef = getWeapon('knife');
            const R = kDef.range || 2.2;
            const coneDot = kDef.coneDot || 0.65;
            const backstabDot = (kDef.backstabDot !== undefined) ? kDef.backstabDot : -0.35;
            let best = null;
            let bestDist = 1e9;
            const fx = { x: p.x + Math.sin(p.yaw) * 1.0, y: p.y, z: p.z + Math.cos(p.yaw) * 1.0 };

            for (const tP of players.values()) {
              if (tP.id === p.id) continue;
              if (tP.hp <= 0) continue;
              const dx = tP.x - p.x;
              const dz = tP.z - p.z;
              const dist = Math.hypot(dx, dz);
              if (dist > R) continue;
              const fwdx = Math.sin(p.yaw);
              const fwdz = Math.cos(p.yaw);
              const dot = (dx / (dist||1)) * fwdx + (dz / (dist||1)) * fwdz;
              if (dot < coneDot) continue;
              if (dist < bestDist) { best = tP; bestDist = dist; }
            }

            if (best) {
              // backstab if attacker is behind target
              const tx = p.x - best.x;
              const tz = p.z - best.z;
              const tdist = Math.hypot(tx, tz) || 1;
              const tFwdX = Math.sin(best.yaw||0);
              const tFwdZ = Math.cos(best.yaw||0);
              const behindDot = (tx/tdist)*tFwdX + (tz/tdist)*tFwdZ;
              const isBackstab = behindDot < backstabDot;
              const amt = isBackstab ? (kDef.dmgBackstab||999) : (kDef.dmgFront||35);
              const dmg = doDamage({ shooter: p, target: best, amount: amt });
              hitId = dmg.hitId;
              hitHp = dmg.hitHp;
              broadcast({ t:'slash', from:p.id, to: best.id, backstab: isBackstab });
            }
            broadcast({ t: 'shot', weapon, from: p.id, sx: p.x, sy: p.y, sz: p.z, yaw: p.yaw, pitch: p.pitch, ex: fx.x, ey: fx.y, ez: fx.z, hit: hitId, hitHp });

          } else if (weapon === 'grenade_frag' || weapon === 'grenade_impact') {
            // Spawn grenade projectile (server-simulated).
            spawnGrenade({
              kind: weapon,
              ownerId: p.id,
              x: p.x,
              y: p.y + 0.2,
              z: p.z,
              yaw: p.yaw,
              pitch: p.pitch,
              now: nowMs(),
            });
            broadcast({ t:'shot', weapon, from:p.id, sx:p.x, sy:p.y, sz:p.z, yaw:p.yaw, pitch:p.pitch, ex:p.x, ey:p.y, ez:p.z, hit:null, hitHp:null });

          } else if (weapon === 'minigun') {
            // Minigun hitscan — spin/heat already updated above outside the fire-CD gate.
            const mDef = getWeapon('minigun');
            if (!p.powerWeapon || p.powerWeapon !== 'minigun') return;
            if (p.mgOverheat) return;
            if ((p.mgSpin||0) < 0.2) return; // still spinning up
            if ((p.powerAmmo||0) <= 0) {
              p.powerWeapon = null;
              p.powerAmmo = 0;
              // Release any pad hold
              for (const pad of pickupPads) {
                if (pad.heldBy === p.id) { pad.heldBy = null; pad.respawnAt = nowMs() + 30_000; }
              }
              broadcast({ t: 'minigunEmpty', id: p.id });
              broadcast({ t: 'state', state: serializeState() });
              return;
            }

            // Fire rate is controlled by the outer fireCdMs gate (20ms = 50 shots/sec).
            // Spin scales damage slightly: full spin = full dmg, partial spin = reduced.
            p.lastShotAt = t;
            p.powerAmmo = Math.max(0, (p.powerAmmo||0) - 1);
            p.mgHeat = clamp((p.mgHeat||0) + (mDef.heatPerShot||0.012), 0, 1.2);
            if ((p.mgHeat||0) >= (mDef.overheatAt||1.0)) { p.mgOverheat = 1; }

            const hit = rayHit(p, mDef.range||32);
            const dmgAmt = mDef.dmg||9;
            const dmg = doDamage({ shooter: p, target: hit.target, amount: dmgAmt });
            hitId = dmg.hitId; hitHp = dmg.hitHp;
            broadcast({ t:'shot', weapon:'minigun', from:p.id, sx:p.x, sy:p.y, sz:p.z, yaw:p.yaw, pitch:p.pitch, ex: hit.endX, ey: p.y, ez: hit.endZ, hit: hitId, hitHp });

          } else if (weapon === 'rifle') {
            const hit = rayHit(p, 30);
            let dmgAmt = 25;
            if (hit.target) {
              const d = dist2D(p, hit.target);
              dmgAmt = damageFalloff(25, d, { near: 5, far: 30, minMult: 0.55 });
            }
            const dmg = doDamage({ shooter: p, target: hit.target, amount: dmgAmt });
            hitId = dmg.hitId;
            hitHp = dmg.hitHp;

            broadcast({
              t: 'shot',
              weapon,
              dmg: dmgAmt,
              from: p.id,
              sx: p.x,
              sy: p.y,
              sz: p.z,
              yaw: p.yaw,
              pitch: p.pitch,
              ex: hit.endX,
              ey: p.y,
              ez: hit.endZ,
              hit: hitId,
              hitHp,
            });
          } else if (weapon === 'sniper') {
            // Sniper: body shot = 50% HP, headshot = instant kill.
            const hit = rayHit3D(p, 80);
            const isHead = hit.part === 'head';
            const dmgAmt = isHead ? 999 : 50;
            const dmg = doDamage({ shooter: p, target: hit.target, amount: dmgAmt });
            hitId = dmg.hitId;
            hitHp = dmg.hitHp;

            broadcast({
              t: 'shot',
              weapon,
              part: hit.part,
              from: p.id,
              sx: p.x,
              sy: p.y,
              sz: p.z,
              yaw: p.yaw,
              pitch: p.pitch,
              ex: hit.endX,
              ey: hit.endY,
              ez: hit.endZ,
              hit: hitId,
              hitHp,
            });
          } else if (weapon === 'rocket') {
            // Rocket launcher: direct hit = instant kill; otherwise splash damage.
            const hit = rayHit3D(p, 80);
            const ex = hit.endX, ey = hit.endY, ez = hit.endZ;
            const R = 6;

            // Direct hit
            if (hit.target) {
              const dmg = doDamage({ shooter: p, target: hit.target, amount: 999 });
              hitId = dmg.hitId;
              hitHp = dmg.hitHp;
            }

            // Splash
            for (const tP of players.values()) {
              if (tP.id === p.id) continue;
              if (tP.hp <= 0) continue;
              if (hit.target && tP.id === hit.target.id) continue; // already applied direct

              const dx = tP.x - ex;
              const dy = (tP.y || 1.8) - ey;
              const dz = tP.z - ez;
              const dist = Math.hypot(dx, dy, dz);
              if (dist > R) continue;

              let dmgAmt;
              if (dist <= 2) dmgAmt = 999;
              else {
                const tt = (dist - 2) / (R - 2);
                dmgAmt = Math.max(10, Math.round(999 * (1 - tt)));
                dmgAmt = Math.min(90, dmgAmt);
              }
              const dmg = doDamage({ shooter: p, target: tP, amount: dmgAmt });
              if (dmg.hitId) { hitId = hitId || dmg.hitId; hitHp = hitHp ?? dmg.hitHp; }
            }

            broadcast({ t: 'explosion', x: ex, y: ey, z: ez, r: R });

            broadcast({
              t: 'shot',
              weapon,
              from: p.id,
              sx: p.x,
              sy: p.y,
              sz: p.z,
              yaw: p.yaw,
              pitch: p.pitch,
              ex,
              ey,
              ez,
              hit: hitId,
              hitHp,
            });
          } else if (weapon === 'fart') {
            // Fart gun: applies a 5s fart cloud debuff; -5 HP per second.
            const hit = rayHit(p, 22);
            if (hit.target) {
              const tNow = nowMs();
              hit.target.fartUntil = tNow + 5000;
              hit.target.fartTickAt = tNow; // tick immediately on next loop
              broadcast({ t: 'fart', from: p.id, to: hit.target.id, until: hit.target.fartUntil });
              broadcast({ t: 'fartPuff', to: hit.target.id });
            }

            broadcast({
              t: 'shot',
              weapon,
              from: p.id,
              sx: p.x,
              sy: p.y,
              sz: p.z,
              yaw: p.yaw,
              pitch: p.pitch,
              ex: hit.endX,
              ey: p.y,
              ez: hit.endZ,
              hit: hit.target ? hit.target.id : null,
              hitHp: hit.target ? hit.target.hp : null,
            });
          } else {
            // Shotgun: multiple pellets with small yaw spread.
            const pellets = 6;
            const spread = 0.14; // radians
            const basePerPellet = 10;
            const traces = [];
            for (let i = 0; i < pellets; i++) {
              const off = (Math.random() * 2 - 1) * spread;
              const hit = rayHit(p, 22, p.yaw + off);
              traces.push({ ex: hit.endX, ez: hit.endZ, hit: hit.target ? hit.target.id : null });
              let pelletDmg = basePerPellet;
              if (hit.target) {
                const d = dist2D(p, hit.target);
                pelletDmg = damageFalloff(basePerPellet, d, { near: 3, far: 22, minMult: 0.45 });
              }
              const dmg = doDamage({ shooter: p, target: hit.target, amount: pelletDmg });
              if (dmg.hitId) { hitId = dmg.hitId; hitHp = dmg.hitHp; }
            }
            broadcast({
              t: 'shot',
              weapon,
              from: p.id,
              sx: p.x,
              sy: p.y,
              sz: p.z,
              yaw: p.yaw,
              pitch: p.pitch,
              traces,
              hit: hitId,
              hitHp,
            });
          }
        }
      }

      return;
    }
  });

  ws.on('close', () => {
    const id = clients.get(ws);
    clients.delete(ws);

    if (id) {
      // If this ws is the active connection, mark player as disconnected but keep state
      // for a short grace period so reconnect (same clientId) doesn't create a "new user".
      if (playerConn.get(id) === ws) {
        playerConn.delete(id);
        const p = players.get(id);
        if (p) p.disconnectedAt = nowMs();
      }
    }

    broadcast({ t: 'state', state: serializeState() });
  });
});

setInterval(() => {
  // Handle respawns + reload completion + fart debuff + cleanup disconnected players
  const t = nowMs();
  // expire minigun drop
  if (minigunDrop && t >= (minigunDrop.expiresAt||0)) {
    minigunDrop = null;
  }

  // Sanity-check pickup pads: release hold if player no longer exists or lost the weapon
  for (const pad of pickupPads) {
    if (!pad.heldBy) continue;
    const holder = players.get(pad.heldBy);
    if (!holder || holder.powerWeapon !== 'minigun') {
      pad.heldBy = null;
      pad.respawnAt = t + 15_000; // 15s before pad respawns
    }
  }


  // simulate grenades (simple physics + bounce)
  {
    const dt = 1 / TICK_HZ;
    const grav = -18;
    const groundY = 1.8;
    const b = getActiveMap().bounds;

    for (const gr of grenades) {
      if (gr.exploded) continue;

      // fuse detonation
      if (t >= gr.fuseAt) {
        gr.exploded = true;
        explodeGrenade(gr, gr.x, gr.y, gr.z);
        continue;
      }

      // integrate
      gr.vy += grav * dt;
      gr.x += gr.vx * dt;
      gr.y += gr.vy * dt;
      gr.z += gr.vz * dt;

      const bounce = (getWeapon(gr.kind).bounce || 0.5);

      // world bounds bounce
      if (gr.x < b.minX) { gr.x = b.minX; gr.vx = Math.abs(gr.vx) * bounce; }
      if (gr.x > b.maxX) { gr.x = b.maxX; gr.vx = -Math.abs(gr.vx) * bounce; }
      if (gr.z < b.minZ) { gr.z = b.minZ; gr.vz = Math.abs(gr.vz) * bounce; }
      if (gr.z > b.maxZ) { gr.z = b.maxZ; gr.vz = -Math.abs(gr.vz) * bounce; }

      // ground collide
      if (gr.y <= groundY) {
        gr.y = groundY;
        if (Math.abs(gr.vy) > 1.4) gr.vy = Math.abs(gr.vy) * bounce;
        else gr.vy = 0;
        gr.vx *= 0.94;
        gr.vz *= 0.94;

        // impact grenade detonates on first ground contact after arm
        const gDef = getWeapon(gr.kind);
        if (gDef.impact && t >= gr.armAt) {
          gr.exploded = true;
          explodeGrenade(gr, gr.x, gr.y, gr.z);
          continue;
        }
      }
    }

    // prune
    for (let i = grenades.length - 1; i >= 0; i--) {
      if (grenades[i].exploded) grenades.splice(i, 1);
    }
  }

  for (const p of players.values()) {
    if (p.hp <= 0 && p.respawnAt && t >= p.respawnAt) respawn(p);
    if (p.hp > 0 && p.reloadUntil && t >= p.reloadUntil) { p.ammo = 12; p.reloadUntil = 0; }

    // Fart cloud DOT: -5 HP each second for up to 5s
    if (p.hp > 0 && p.fartUntil && t < p.fartUntil) {
      if (!p.fartTickAt) p.fartTickAt = t;
      if (t - p.fartTickAt >= 1000) {
        p.fartTickAt = t;
        // Apply damage without awarding a kill to a specific shooter.
        p.hp = Math.max(0, p.hp - 5);
        broadcast({ t: 'fartDot', to: p.id, dmg: 5 });
        if (p.hp <= 0) {
          p.hp = 0;
          p.respawnAt = t + 2000;
        }
      }
    }

    if (p.fartUntil && t >= p.fartUntil) {
      p.fartUntil = 0;
      p.fartTickAt = 0;
    }
  }

  // Reconnect grace window: keep disconnected players briefly so they don't rejoin as "new users".
  const GRACE_MS = 30_000;
  for (const [id, p] of Array.from(players.entries())) {
    if (playerConn.has(id)) continue;
    if (!p.disconnectedAt) continue;
    if (t - p.disconnectedAt > GRACE_MS) {
      players.delete(id);
      playerConn.delete(id);
      for (const [cid, pid] of Array.from(clientToPlayer.entries())) {
        if (pid === id) clientToPlayer.delete(cid);
      }
      if (GAME.hostId === id) GAME.hostId = players.keys().next().value || null;
      // Release any pickup pad this player was holding so it can be picked up again
      for (const pad of pickupPads) {
        if (pad.heldBy === id) {
          pad.heldBy = null;
          pad.respawnAt = t + 15_000; // 15s cooldown before pad is available again
        }
      }
    }
  }

  if (players.size === 0) {
    GAME.hostId = null;
    GAME.started = false;
  }

  broadcast({ t: 'state', state: serializeState() });
}, Math.round(1000 / TICK_HZ));

// Drop stale/ghost connections (mobile Safari tabs can linger).
setInterval(() => {
  const t = nowMs();

  // Time-based round end
  if (GAME.started && GAME.roundEndsAt && t >= GAME.roundEndsAt && !GAME.roundOverAt) {
    let best = null;
    for (const p of players.values()) {
      if (!best || (p.score||0) > (best.score||0)) best = p;
    }
    GAME.roundOverAt = t;
    broadcast({ t: 'winner', winnerId: best ? best.id : null, winnerName: best ? best.name : '—' });

    setTimeout(() => {
      try {
        for (const p of players.values()) {
          p.score = 0;
          p.deaths = 0;
          respawn(p);
        }
        GAME.started = false;
        GAME.roundOverAt = 0;
        GAME.roundEndsAt = 0;
        GAME.firstBlood = false;
        broadcast({ t: 'state', state: serializeState() });
      } catch {}
    }, 5000);
  }

  // AFK cleanup
  for (const p of players.values()) {
    const li = p.lastInputAt || 0;
    if (li && (t - li) > AFK_MS) {
      players.delete(p.id);
      broadcast({ t: 'leave', id: p.id });
    }
  }
  for (const ws of wss.clients) {
    // If we haven't heard anything in a while, kill it.
    // Kill truly dead/ghost tabs quickly (mobile browsers sometimes leave sockets half-open).
    if (ws.lastMsgAt && (t - ws.lastMsgAt) > 120_000) {
      try { ws.terminate(); } catch {}
      continue;
    }
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch {}
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 15_000);

server.listen(PORT, () => {
  console.log(`Hunter Boyz server on http://0.0.0.0:${PORT}`);
});
