# Hunter Boyz — Project Index

Mobile-first (iPhone/iPad Safari) multiplayer 3D web shooter. Built with Babylon.js on the client and Node.js + WebSocket on the server.

---

## Entry points

| File | Role |
|------|------|
| `server.js` | All game logic: physics, maps, weapons, teleport, pickups, grenades, scoring |
| `public/index.html` | Client shell: loads Babylon.js scene, imports modules |
| `public/app/modules/core-state-network.js` | Client state: parses server state, renders players/HUD/signposts |
| `public/app/modules/controls-loop.js` | Client input: virtual joystick, buttons (shoot/jump/tower/reload) |
| `public/components/controls.html` | Button HTML injected into the UI |
| `public/weapons.js` | Weapon stats table (UMD): `{ WEAPONS, getWeapon }` |
| `public/styles.css` | All UI styles |

---

## Maps

Defined in `server.js` → `const MAPS = { ... }`.

| Map | ID | Description |
|-----|----|-------------|
| Arena | `arena` | Open arena with floating crates. Default map. |
| Mansion | `mansion` | CS-style: perimeter → courtyard → door choke → interior. Has mansion tower (teleport). |

Each map defines: `bounds`, `spawnPoints`, `obstacles[]`, `pickupPads[]`.

---

## Core systems

### Physics (server.js ~line 1020)
- Runs per client input message (`msg.t === 'input'`).
- CS-style accel/friction. Gravity = -18 units/s².
- `effectiveGroundY(x, z)` — returns the eye-height floor level at any XZ position, accounting for ALL obstacle surfaces (not just ground). Allows players to stand on any obstacle.
- XZ collision: `collides(x, z)` — skips obstacles the player is already standing on top of (avoids lateral block from obstacles below).
- `groundY` is fully dynamic; hardcoded floor at y=1.8 is the fallback.

### Weapons (public/weapons.js + server.js)
- Rifle (default hitscan), Knife (melee, no tracer), Grenade (projectile arc), Minigun (power weapon pickup).
- One visible tracer line per shot max. No multi-line impact sparks.
- Minigun: spin-up lives OUTSIDE the fire-cooldown gate (critical for spin to build up).

### Teleport (server.js ~line 650 + 894)
- Mansion only. Tower ↑ sends player to platform top (y=25.0). Tower ↓ sends to base (y=1.8).
- Buttons shown within 6 units. Server also validates within 6 units.
- Signpost billboard planes pulse above each pad to aid discoverability.

### Pickup system (server.js ~line 930)
- Minigun spawns at fixed pads per map. Player steps near pad → PICK UP button appears.
- Player can DROP GUN — spawns a `minigunDrop` at current position for others.
- Pads release `heldBy` on player disconnect/cleanup (important for iOS backgrounding).

### Scoring / round flow (server.js ~line 1700)
- `WIN_SCORE = 8` kills wins the round. Round timer = 90 seconds.
- First blood triggers announcements. Round-over → short delay → new round.
- `GAME.started` must be true for any gameplay (set by host pressing Start button, or via `/debug/start` localhost endpoint).

---

## Tools

| File | Purpose |
|------|---------|
| `tools/smoke-test.js` | Automated smoke test — run before shipping |
| `tools/capture-iphone.js` | Screenshot capture for proof/debugging |

---

## Key constants (server.js)

| Name | Value | Notes |
|------|-------|-------|
| `WIN_SCORE` | 8 | Kills to win a round |
| `ROUND_MS` | 90 000 ms | Round duration |
| `AFK_MS` | 60 000 ms | AFK kick threshold |
| `playerEyeHeight` | 1.8 | Used for floor offset math |
| `radius` (capsule) | 0.7 | Player XZ collision capsule |
| `gravity` | -18 | Units/s² |
| `jumpV` | 7.8 | Jump velocity (max height ~1.7 units) |
| `baseSpeed` | 8 | Walk speed (units/s) |
| `speed` (sprint) | 11.5 | Sprint speed |

---

## iOS / mobile notes
- iOS Safari aggressively caches. Use `?v=N` in URL to bust.
- WebAudio unlock must be synchronous inside a gesture handler (no async in that path).
- iOS backgrounding can silently drop WebSocket — server must release pad locks on disconnect.
- Prefer `isVisible` per mesh over `setEnabled` (Babylon `setEnabled(false)` cascades but `setEnabled(true)` does not reliably re-enable children).
