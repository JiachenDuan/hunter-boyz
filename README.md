# Hunter Boyz

LAN first-person “Minecraft-y” shooter MVP for iPhone Safari.

## Run (simple)
```bash
npm install
npm start
```
Open on the same Wi‑Fi:
- http://<mac-mini-lan-ip>:3030

## Run (recommended: keep server alive)
Using PM2 (installed as a dev dependency in this repo):
```bash
npm install
npm run start:pm2d
```
Stop:
```bash
npm run stop:pm2
```
Logs:
```bash
npm run logs:pm2
```

## Controls (iPhone)
- Left stick: move
- Right side drag: look/turn
- Blue: jump
- Red: shoot (toggle “Auto-fire” for tap-to-toggle)

## Notes
- Static hosting (GitHub Pages) won’t work because this is a realtime WebSocket game.
- `/debug/*` endpoints exist for automated screenshots and only accept localhost requests.
