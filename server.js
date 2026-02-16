const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3030;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

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
const WORLD = {
  bounds: { minX: -25, maxX: 25, minZ: -25, maxZ: 25 },
  spawnPoints: [
    { x: -10, y: 1.8, z: -10 },
    { x: 10, y: 1.8, z: -10 },
    { x: 0, y: 1.8, z: 12 },
  ],
  // Must roughly match client scene blocks for collision.
  obstacles: [
    { x: 0, y: 1.5, z: 0, w: 3, h: 3, d: 3 },
    { x: -8, y: 1, z: 6, w: 4, h: 2, d: 6 },
    { x: 10, y: 1.5, z: -6, w: 6, h: 3, d: 3 },
  ],
};

const GAME = {
  started: false,
  hostId: null,
};

let nextId = 1;
const clients = new Map(); // ws -> playerId
const players = new Map(); // id -> player state

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function nowMs() { return Date.now(); }

function makePlayer(name) {
  const id = String(nextId++);
  const sp = WORLD.spawnPoints[(Number(id) - 1) % WORLD.spawnPoints.length];
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
    lastShotAt: 0,
    respawnAt: 0,
    invulnUntil: 0,
    ammo: 12,
    reloadUntil: 0,
    color: `hsl(${hue} 80% 60%)`,
  };
}

function serializeState() {
  return {
    ts: nowMs(),
    game: { started: GAME.started, hostId: GAME.hostId },
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
      ammo: p.ammo,
      reloadInMs: Math.max(0, p.reloadUntil - nowMs()),
      invulnInMs: Math.max(0, p.invulnUntil - nowMs()),
      respawnInMs: p.hp > 0 ? 0 : Math.max(0, p.respawnAt - nowMs()),
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
  const sp = WORLD.spawnPoints[Math.floor(Math.random() * WORLD.spawnPoints.length)];
  p.x = sp.x; p.y = sp.y; p.z = sp.z;
  p.vy = 0;
  p.hp = 100;
  p.respawnAt = 0;
  p.invulnUntil = nowMs() + 1000;
  p.ammo = 12;
  p.reloadUntil = 0;
}

function rayHit(shooter, maxDist = 30, yawOverride = null) {
  // Simple hitscan in XZ plane + pitch ignored for MVP.
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

function doDamage({ shooter, target, amount }) {
  const t = nowMs();
  if (!target || target.hp <= 0) return { hitId: null, hitHp: null, killed: false };
  if (t < (target.invulnUntil || 0)) return { hitId: null, hitHp: null, killed: false };
  target.hp -= amount;
  if (target.hp <= 0) {
    target.hp = 0;
    target.respawnAt = t + 2000;
    shooter.score += 1;
    broadcast({ t: 'kill', killer: shooter.id, killerName: shooter.name, victim: target.id, victimName: target.name });
    return { hitId: target.id, hitHp: target.hp, killed: true };
  }
  return { hitId: target.id, hitHp: target.hp, killed: false };
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.lastMsgAt = nowMs();
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (buf) => {
    ws.lastMsgAt = nowMs();
    let msg;
    try { msg = JSON.parse(buf.toString('utf8')); } catch { return; }

    if (msg.t === 'join') {
      const p = makePlayer(msg.name);
      clients.set(ws, p.id);
      players.set(p.id, p);

      if (!GAME.hostId) GAME.hostId = p.id;

      ws.send(JSON.stringify({ t: 'welcome', id: p.id, state: serializeState(), world: WORLD }));
      broadcast({ t: 'state', state: serializeState() });
      return;
    }

    const id = clients.get(ws);
    if (!id) return;
    const p = players.get(id);
    if (!p) return;

    if (msg.t === 'start') {
      if (id === GAME.hostId) {
        GAME.started = true;
        broadcast({ t: 'state', state: serializeState() });
      }
      return;
    }

    if (msg.t === 'reload') {
      if (!GAME.started) return;
      if (p.hp <= 0) return;
      const t = nowMs();
      if (t < p.reloadUntil) return;
      if (p.ammo >= 12) return;
      p.reloadUntil = t + 900;
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

    if (msg.t === 'input') {
      // Ignore gameplay until host starts.
      if (!GAME.started) return;

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

      function collides(x, z) {
        for (const o of WORLD.obstacles) {
          const minX = o.x - o.w/2 - radius;
          const maxX = o.x + o.w/2 + radius;
          const minZ = o.z - o.d/2 - radius;
          const maxZ = o.z + o.d/2 + radius;
          if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) return true;
        }
        return false;
      }

      // try x, then z (axis-separable)
      let xTry = clamp(nextX, WORLD.bounds.minX, WORLD.bounds.maxX);
      let zTry = clamp(nextZ, WORLD.bounds.minZ, WORLD.bounds.maxZ);

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
        const weapon = msg.weapon === 'shotgun' ? 'shotgun' : 'rifle';
        const fireCdMs = weapon === 'shotgun' ? 650 : 250;

        if (t - p.lastShotAt > fireCdMs) {
          // can't shoot while reloading
          if (t < p.reloadUntil) return;

          // auto-reload if empty
          if (p.ammo <= 0) {
            p.reloadUntil = t + 900;
            return;
          }

          p.lastShotAt = t;
          p.ammo -= 1;

          let hitId = null;
          let hitHp = null;

          if (weapon === 'rifle') {
            const hit = rayHit(p);
            const dmg = doDamage({ shooter: p, target: hit.target, amount: 25 });
            hitId = dmg.hitId;
            hitHp = dmg.hitHp;

            broadcast({
              t: 'shot',
              weapon,
              from: p.id,
              sx: p.x,
              sy: p.y,
              sz: p.z,
              ex: hit.endX,
              ey: p.y,
              ez: hit.endZ,
              hit: hitId,
              hitHp,
            });
          } else {
            // Shotgun: multiple pellets with small yaw spread.
            const pellets = 6;
            const spread = 0.14; // radians
            const dmgPerPellet = 10;
            const traces = [];
            for (let i = 0; i < pellets; i++) {
              const off = (Math.random() * 2 - 1) * spread;
              const hit = rayHit(p, 22, p.yaw + off);
              traces.push({ ex: hit.endX, ez: hit.endZ, hit: hit.target ? hit.target.id : null });
              const dmg = doDamage({ shooter: p, target: hit.target, amount: dmgPerPellet });
              if (dmg.hitId) { hitId = dmg.hitId; hitHp = dmg.hitHp; }
            }
            // broadcast a single event with multiple tracer segments
            broadcast({
              t: 'shot',
              weapon,
              from: p.id,
              sx: p.x,
              sy: p.y,
              sz: p.z,
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
    if (id) players.delete(id);

    // If the host left, reassign host to the next connected player and pause game.
    if (id && GAME.hostId === id) {
      const next = players.keys().next().value || null;
      GAME.hostId = next;
      GAME.started = false;
    }

    // If no players remain, reset game.
    if (players.size === 0) {
      GAME.hostId = null;
      GAME.started = false;
    }

    broadcast({ t: 'state', state: serializeState() });
  });
});

setInterval(() => {
  // Handle respawns + reload completion
  const t = nowMs();
  for (const p of players.values()) {
    if (p.hp <= 0 && p.respawnAt && t >= p.respawnAt) respawn(p);
    if (p.hp > 0 && p.reloadUntil && t >= p.reloadUntil) { p.ammo = 12; p.reloadUntil = 0; }
  }
  broadcast({ t: 'state', state: serializeState() });
}, Math.round(1000 / TICK_HZ));

// Drop stale/ghost connections (mobile Safari tabs can linger).
setInterval(() => {
  const t = nowMs();
  for (const ws of wss.clients) {
    // If we haven't heard anything in a while, kill it.
    if (ws.lastMsgAt && (t - ws.lastMsgAt) > 45_000) {
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
