# chessooly

A small, free, privacy-friendly chess website for playing with a friend — plus a few special game modes and training games.

- **No accounts.** No sign-up, no email, no names required.
- **No data stored.** No database, no cookies for tracking, no analytics. Games live only in the two players' browsers and disappear when the tab is closed.
- **Self-hostable.** The whole app is a static website — drop the build folder on any web host (or your own machine) and it works.

## Features

### Play with a friend
1. Open the site and click **New game**.
2. Share the generated invite link with your friend.
3. Your friend opens the link and the game starts — moves are sent directly between your browsers (peer-to-peer).

Also available: **Local mode** — two players on the same device (pass-and-play).

### Special game modes
| Mode | Description |
|------|-------------|
| **Chess960 (Fischer Random)** | Back-rank pieces are shuffled at the start. |
| **King of the Hill** | Win by getting your king to one of the four center squares. |
| **Three-Check** | Win by giving check three times. |
| **Atomic** | Captures explode, removing all non-pawn pieces around the square. |
| **Horde** | One side has 36 pawns against a normal army. |
| **Fog of War** | You only see the squares your pieces can reach. |

*(Modes are planned / in progress — see the roadmap below.)*

### Training games
| Game | Description |
|------|-------------|
| **Coordinate trainer** | A square is named — click it as fast as you can. |
| **Knight's tour** | Visit every square with a knight exactly once. |
| **Mate-in-N puzzles** | Solve built-in checkmate puzzles. |
| **Play vs. computer** | Practise against Stockfish running in your browser, with adjustable strength. |
| **Blindfold mode** | Play with pieces hidden to train visualisation. |

## How it works

```
 Player A (browser)  <──── WebRTC peer-to-peer ────>  Player B (browser)
        │                                                    │
        └──────── both load static files from ───────────────┘
                   GitHub Pages / any static host
```

- **Frontend only** — HTML, CSS and JavaScript/TypeScript, built with [Vite](https://vitejs.dev/).
- **Rules & move validation** — [chess.js](https://github.com/jhlywa/chess.js) (variants via [chessops](https://github.com/niklasf/chessops)).
- **Board UI** — [chessground](https://github.com/lichess-org/chessground) (the board used by Lichess).
- **Multiplayer** — [PeerJS](https://peerjs.com/) (WebRTC). The free public PeerJS server is only used to introduce the two browsers to each other; game moves never pass through or get stored on a server.
- **Computer opponent** — [Stockfish](https://github.com/nmrugg/stockfish.js) compiled to WebAssembly, running locally in a Web Worker.

## Getting started

Requirements: [Node.js](https://nodejs.org/) 20+.

```bash
git clone https://github.com/<your-username>/chessooly.git
cd chessooly
npm install
npm run dev        # start local dev server at http://localhost:5173
npm run build      # production build into ./dist
npm run preview    # serve the production build locally
```

## Deployment (free)

Because the app is just static files, any static host works:

- **GitHub Pages** — push to `main`; a GitHub Actions workflow builds and publishes `dist/`.
- **Cloudflare Pages / Netlify / Vercel** — connect the repo, build command `npm run build`, output directory `dist`.
- **Self-host** — copy `dist/` to any web server (nginx, Apache, Caddy, or `npx serve dist`).

> HTTPS is required for WebRTC to work outside `localhost`. All the hosts above provide it automatically.

## Privacy

chessooly does not collect, store or share any personal data. There is no backend database. The only third-party connection is the PeerJS signalling server, which briefly exchanges connection info so two browsers can find each other. You can run your own signalling server (`npx peerjs --port 9000`) if you prefer.

## Roadmap

- [x] Board + local pass-and-play
- [x] Online play via invite link
- [ ] Play vs. Stockfish
- [ ] Chess960, King of the Hill, Three-Check
- [ ] Atomic, Horde, Fog of War
- [ ] Training games (coordinates, knight's tour, puzzles, blindfold)
- [ ] Time controls (clocks)
- [ ] Mobile-friendly layout

## Contributing

Issues and pull requests are welcome. Please keep the core principles: **no accounts, no tracking, no stored data.**

## License

GPL-3.0 (required because chessground and chessops are GPL-3.0 licensed).
