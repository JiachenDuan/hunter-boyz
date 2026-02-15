const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3030;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

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
    yaw: 0,
    pitch: 0,
    hp: 100,
    score: 0,
    lastShotAt: 0,
    color: `hsl(${hue} 80% 60%)`,
  };
}

function serializeState() {
  return {
    ts: nowMs(),
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
  p.hp = 100;
}

function rayHit(shooter, maxDist = 30) {
  // Simple hitscan in XZ plane + pitch ignored for MVP.
  const dirX = Math.sin(shooter.yaw);
  const dirZ = Math.cos(shooter.yaw);

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
  return best?.target || null;
}

wss.on('connection', (ws) => {
  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString('utf8')); } catch { return; }

    if (msg.t === 'join') {
      const p = makePlayer(msg.name);
      clients.set(ws, p.id);
      players.set(p.id, p);
      ws.send(JSON.stringify({ t: 'welcome', id: p.id, state: serializeState(), world: WORLD }));
      broadcast({ t: 'state', state: serializeState() });
      return;
    }

    const id = clients.get(ws);
    if (!id) return;
    const p = players.get(id);
    if (!p) return;

    if (msg.t === 'input') {
      const dt = clamp(Number(msg.dt || 0.05), 0, 0.2);
      const mv = msg.move || { x: 0, z: 0 };
      const speed = 8; // units/sec

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

      p.x += (rightX * mx + fwdX * mz) * speed * dt;
      p.z += (rightZ * mx + fwdZ * mz) * speed * dt;

      p.x = clamp(p.x, WORLD.bounds.minX, WORLD.bounds.maxX);
      p.z = clamp(p.z, WORLD.bounds.minZ, WORLD.bounds.maxZ);

      p.yaw = yaw;
      p.pitch = clamp(Number(msg.look?.pitch ?? p.pitch), -1.2, 1.2);

      if (msg.shoot) {
        const t = nowMs();
        if (t - p.lastShotAt > 250) {
          p.lastShotAt = t;
          const target = rayHit(p);
          if (target) {
            target.hp -= 25;
            if (target.hp <= 0) {
              p.score += 1;
              respawn(target);
            }
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
    broadcast({ t: 'state', state: serializeState() });
  });
});

setInterval(() => {
  broadcast({ t: 'state', state: serializeState() });
}, Math.round(1000 / TICK_HZ));

server.listen(PORT, () => {
  console.log(`Hunter Boyz server on http://0.0.0.0:${PORT}`);
});
