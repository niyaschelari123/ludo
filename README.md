# Ludo Live

A React + Socket.IO real-time Ludo game for 2–8 remote players.

## Architecture

- **Frontend** (`/`): React + Vite, connects via `socket.io-client`
- **Backend** (`/server`): Node.js + Express + Socket.IO, in-memory game rooms

## Run locally

Terminal 1 — game server:

```bash
cd server
npm install
npm run dev
```

Terminal 2 — React app:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open the Vite URL (usually `http://localhost:5173`) on separate devices or
browser tabs. Create a room, share the six-character code, and play.

Or run both from the repo root after installing dependencies:

```bash
npm install
npm run dev:all
```

## Socket events

| Direction | Event | Purpose |
|-----------|-------|---------|
| Client → Server | `createRoom` | Host a lobby (2–8 players, classic/power) |
| Client → Server | `joinRoom` | Join by room code |
| Client → Server | `startRoom` | Host starts the match |
| Client → Server | `rollDice` | Roll dice (validated server-side) |
| Client → Server | `movePawn` | Move a token |
| Client → Server | `leaveRoom` | Leave and rebalance turns |
| Client → Server | `syncRoom` | Reconnect and fetch latest state |
| Server → Client | `stateUpdate` | Full room snapshot |
| Server → Client | `moveStart` | Token animation hint (`activeMove`) |
| Server → Client | `playerDisconnect` | Player socket dropped |

## Deploy (free-tier friendly)

### Backend (Render / Fly.io / Railway)

1. Create a **Web Service** pointing at the `server/` folder.
2. **Build command:** `npm install`
3. **Start command:** `npm start`
4. **Environment variables:**
   - `PORT` — usually provided by the host (e.g. `10000` on Render)
   - `CORS_ORIGIN` — your frontend URL, e.g. `https://your-app.vercel.app`

A `render.yaml` blueprint is included for one-click Render setup.

### Frontend (Vercel / Netlify / Render static)

1. Connect the repo root.
2. **Build command:** `npm run build`
3. **Output directory:** `dist`
4. **Environment variable:**
   - `VITE_SOCKET_URL` — your deployed backend URL, e.g. `https://ludo-api.onrender.com`

> Free tiers sleep after inactivity. First connection after idle may take
> 30–60 seconds while the server wakes up.

## Game rules

- Four tokens per player, up to eight players.
- Roll 6 to leave the yard; starting cells are safe.
- Capture, home arrival, or rolling 6 grants another turn.
- Three consecutive sixes forfeit the turn.
- Home requires an exact roll.
- **Power mode** adds special tiles (TNT, rocket, spring, shield, etc.).

## Notes

- Game state lives in server memory — rooms are lost on server restart.
- Dice rolls are validated on the server using the shared rules engine.
- Player identity is a browser-stored UUID (`localStorage`), no login required.
