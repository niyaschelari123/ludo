# Ludo Live

A React + Firebase real-time Ludo game for 2–8 remote players.

## Firebase setup

1. Create a project in the [Firebase Console](https://console.firebase.google.com/).
2. Add a Web App and copy its configuration.
3. Enable **Authentication → Sign-in method → Anonymous**.
4. Create a Firestore database.
5. Copy `.env.example` to `.env.local` and fill in the values.
6. Install the Firebase CLI and deploy the included `firestore.rules`.

```bash
npm install -g firebase-tools
firebase login
firebase init firestore
firebase deploy --only firestore:rules
```

## Run locally

```bash
npm install
npm run dev
```

Open the displayed URL on separate devices, create a room, and join with its
six-character code.

## Implemented rules

- Four tokens per player and up to eight players.
- A six is required to enter the track.
- Starting cells are safe.
- A six, capture, or arrival home grants another turn.
- Three consecutive sixes forfeit the turn.
- Home requires an exact roll.
- Players are ranked after all four tokens reach home.

## Production hardening

Firestore transactions prevent conflicting simultaneous moves, but this MVP
calculates dice rolls and validates moves in the browser. Before public or
competitive use, move game actions into Firebase callable Cloud Functions.
Also add App Check, turn timeouts, presence expiry, and rate limiting.
