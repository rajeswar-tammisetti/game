# Web 1v1 Arena (Jam Minimal)

Minimal 1v1 browser shooter that works across two computers.

## Stack

- Node.js + Express
- Socket.IO (real-time networking)
- HTML5 Canvas client
- Authoritative server simulation (movement, hit check, damage, respawn, score)

## Run

```bash
npm install
npm start
```

If port `3000` is already used:

```bash
set PORT=3010 && npm start
```

Open in browser:

```text
http://localhost:3000
```

or if using another port:

```text
http://localhost:3010
```

## Two Computers Test

1. Start server on PC1.
2. Find PC1 local IP (example `192.168.1.8`).
3. On both PCs open `http://<PC1-IP>:3000`.
4. PC1 clicks `Create Room`.
5. PC2 enters the room code and clicks `Join Room`.

## Controls

- `WASD` move
- Mouse aim
- Left click shoot

## Scope kept intentionally small

- Exactly 2 players
- One arena
- One weapon (hitscan line)
- Health/damage/respawn
- Kill/death score

## Free Deployment (Render)

1. Create a new GitHub repo and push this project:

```bash
git init
git add .
git commit -m "Initial 1v1 web game"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

2. In Render:
- Open dashboard -> `New` -> `Blueprint`
- Connect your GitHub repo
- It will detect `render.yaml`
- Click `Apply`

3. After deploy, open:

```text
https://<your-render-service>.onrender.com
```

4. Share this same URL with both players, then:
- Player 1: `Create Room`
- Player 2: enter room code -> `Join Room`
