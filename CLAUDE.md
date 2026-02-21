# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow (mandatory)

After every fix or feature:
1. **Commit** with a clear message describing what changed.
2. **Update `HUNTER_BOYZ.md`** under the relevant section — design intent, tuning knobs, gotchas. No bug history, just the living game plan.

## Commands

```bash
# Run server (dev)
node server.js

# Run server (persistent, survives terminal close)
nohup node server.js > server.log 2>&1 &

# Smoke test (run before shipping)
node tools/smoke-test.js

# Restart server cleanly (kill any existing instance first)
lsof -ti:3030 | xargs kill -9 2>/dev/null; sleep 0.3; node server.js &
```

iOS Safari aggressively caches — always use `?v=N` in the URL to bust cache when testing.

After any server restart, `GAME.started` resets to `false`. A player must press **Start** in the UI before gameplay inputs are accepted.

## Architecture

**Server** (`server.js`) is the single source of truth for all game state. It runs authoritative physics, collision, hitscan, scoring, and round flow. Clients send input; server replies with full state broadcasts.

**Client** is split across:
- `public/app/modules/core-state-network.js` — receives state from server, drives the Babylon.js scene (player meshes, HUD, pickups, signposts)
- `public/app/modules/controls-loop.js` — virtual joystick + all buttons; sends `{t:'input', ...}` messages to server each frame
- `public/app/modules/scene-rig.js` — weapon models and animations
- `public/app/modules/combat-audio-ui.js` — audio + kill feed UI
- `public/weapons.js` — shared weapon stats table (`{ WEAPONS, getWeapon }`), loaded by both client and server

**Maps** are defined inline in `server.js` as `const MAPS = { arena, mansion }`. Each map has `bounds`, `spawnPoints`, `obstacles[]`, `pickupPads[]`. The client has a duplicate obstacle list in `combat-audio-ui.js` for local collision sound cues — keep them in sync when editing map geometry.

**Physics** runs server-side per `{t:'input'}` message:
- `effectiveGroundY(x, z)` — scans all obstacles to find the highest standable surface under the player (eye height = surface top + 1.8). This is what allows standing on platforms and props.
- `collides(x, z)` — XZ-only capsule check; skips obstacles whose top is at or below the player's feet (prevents the tower column from blocking lateral movement when the player is on the platform above it).
- Pitch convention: **positive = look down**, negative = look up. `dirY = -Math.sin(pitch)` in `rayHit3D`.

**Teleport** (mansion only): client buttons send `{t:'teleport', id:'tower_up'|'tower_down'}`. Server validates player is within 6 units of the pad (horizontal) and that the game is started and the player is alive.

## Key invariants

- `GAME.started` gates all gameplay. Teleport, shoot, move, pickup — all return early if `!GAME.started`.
- **One tracer line per shot max.** Line-based impact VFX are banned (root cause of "fan of lines" visual spam). Use a single billboard flash/puff.
- **No external weapon assets.** All weapons use Babylon.js primitives + procedural textures.
- Babylon `setEnabled(false)` cascades to children; `setEnabled(true)` does NOT reliably re-enable children. Use `mesh.isVisible` per mesh instead.
- WebAudio unlock must be synchronous in the gesture handler — no `async/await` in that path.
- iOS backgrounding silently drops WebSocket. Always release `pickupPads[].heldBy` on player disconnect/cleanup.
- Minigun spin-up update must live **outside** the fire-cooldown gate, or `lastShotAt` blocks spin from advancing.
