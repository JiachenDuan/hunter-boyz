# Hunter Boyz — Dev Notes / Spec (Living Doc)

This file exists so future changes don’t regress prior fixes or violate design decisions.

## 1) What this game is
- Mobile-first (iPhone/iPad Safari) multiplayer web shooter.
- Goal: **CS-clean readability** (no visual spam), stable UX, responsive feel.
- Assets constraint: **no external weapon assets**. All weapons must be **Babylon.js primitives + procedural textures**.

## 2) Repo layout
- Server: `server.js` (Node + ws)
- Client: `public/index.html` (most logic is inline)
- Weapon stats table: `public/weapons.js` (UMD export: `{ WEAPONS, getWeapon }`)
- Tools:
  - `tools/smoke-test.js`
  - `tools/capture-iphone.js`

## 3) Operational workflow (important)
### Cache busting (iOS)
- iOS Safari aggressively caches. Use URL cache-busting:
  - `http://192.168.2.134:3030/?v=N`

### Server run (persistence)
- Prefer:
  - `nohup node server.js > server.log 2>&1 &`

### Tests
- Always run:
  - `node tools/smoke-test.js`

### Screenshot policy
- When fixing Hunter Boyz issues, share **game screenshots only** (not terminal screenshots).

## 4) Gameplay state rules
- Server ignores gameplay inputs until the game is started.
  - `server.js`: many actions `return` if `!GAME.started`.
- Client should not show misleading UI when `!state.started`.

## 5) Weapons (design + implementation)
### Effective weapon selection
- Client uses an “effective” weapon:
  - If `meP.powerWeapon === 'minigun'` ⇒ effective weapon is `minigun`
  - Else effective weapon is dropdown `#weapon` (with allowlist + fallback to `rifle`)

### Knife
- Melee only. **No tracers/lines**.
- Uses in-hand stab/thrust animation.

### Grenades
- Not hitscan. **No tracers**.
- Show curved arc and projectile + explosion timing.

### Tracer policy (very strict)
- At most **one** visible tracer line per shot.
- Rapid fire must not stack lines.
- “Fan of lines” root cause was **impact spark line rays**. Line-based impact VFX are disallowed.

## 6) Impact VFX rules
- Avoid multi-line spark rays (confusable with tracers).
- Prefer **single billboard flash/puff** with short TTL and dedupe.

## 7) Minigun (power weapon)
### Pickup system
- Pickups come from `state.pickups` (pads or drops).
- Client shows `PICK UP` only when:
  - `state.started === true`
  - player is near pickup
  - player has no `powerWeapon`

### Drop system
- When holding minigun, client shows **DROP GUN** button.
- Client sends `{t:'dropMinigun'}`.
- Server:
  - clears `powerWeapon`
  - spawns `minigunDrop` at player position (others can pick up)
  - releases any pad holds

### iOS backgrounding / reconnect gotcha
- iOS background can drop websocket.
- Must release `pickupPads[].heldBy` when players disconnect/are cleaned up.

### Firing model
- Heavy machine gun feel: high rate of fire.
- Current tuning (see `public/weapons.js`):
  - `fireCdMs: 20` (50 shots/sec)
  - `rpmMax: 3000`
  - `spinUpPerSec: 6.0`
  - `ammo: 450`

### Important bug history
- **Minigun never fired** because spin-up used to be inside an outer fire-CD gate; `lastShotAt` got set then spin never advanced. Fixed by updating spin **outside** the gate.
- **Minigun model not showing**: Babylon `setEnabled(false)` cascades; `setEnabled(true)` does not reliably re-enable children. Fix is to use `isVisible` per mesh.

## 8) Known UX rules
- Don’t make the user change iOS Accessibility settings.
- WebAudio unlock must be synchronous in gesture handler (avoid async in that path).

## 10) Mansion tower teleport

### Design
- Tower column at (-18, 0, 18), 3.2×22×3.2. Top platform at (-18, 22, 18), 8×1.2×8.
- Two teleport buttons: **TOWER ↑** (base → top) and **TOWER ↓** (top → base).
- Buttons appear when player is within 6 units of the pad (horizontal). DOWN also shows when player Y > 16.
- Server validates same 6-unit radius before accepting the teleport.

### Key values
- `tower_up` destination: `p.y = 25.0` (platform top 23.2 + eye height 1.8)
- `tower_down` destination: `p.y = 1.8, p.z = 16.0` (ground, slightly south of column)

### Physics — standable obstacles
- ALL obstacles (not just ground) are standable surfaces. `effectiveGroundY(x, z)` scans `world.obstacles` and returns the highest `obstacleTop + 1.8` (eye height above surface) for any obstacle under the player.
- `onGround` and gravity floor use `effectiveGroundY`, not a hardcoded 1.8.
- XZ collision skips an obstacle when `playerFeetY >= obstacleTop - 0.05` (player is on top of it), so the column below doesn't block lateral movement on the platform above.

## 9) Recent key commits (for archaeology)
- `a87ee58`: spark-line dedupe (fan-of-lines root cause)
- `55205c7`: rapid-fire tracer stacking + sniper restyle
- `2a44498`: minigun visibility fix (use `isVisible` toggling)
- `cae0f1a`: minigun ROF buff (50 shots/sec)

---
If you add a new weapon or mechanic, update this doc with:
- intended UX behavior
- any strict visual rules
- tuning knobs + default values
- “gotchas” that could regress
