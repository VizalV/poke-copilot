# Poké-Copilot

Real-time AI copilot for competitive Pokémon Showdown players, delivered as a browser
extension. Reads the live battle log, streams the parsed state to a fast-inference LLM
backend, and renders strategic overlays in the Showdown battle UI — headlined by the
**Visual Win-Condition / Game-Tree Pathway Analyzer**, which tags benched Pokémon as
`MUST PRESERVE` / `FLEXIBLE` / `SAFE TO SACRIFICE` based on long-term win probability.

Built on the research and code of [PokéChamp (ICML '25)](https://github.com/sethkarten/pokechamp)
and the [Pokémon Showdown](https://github.com/smogon/pokemon-showdown) simulator.

## Repository layout

```
extension/   Chrome (MV3) extension — React + TypeScript + Vite
  public/    manifest.json + injected.js (page-context script, talks to app.room)
  src/       content script, background service worker, overlay React app,
             @pkmn/protocol-based log parser
backend/     FastAPI inference server (Python, uv)
  app/       websocket endpoint, win-con analyzer, LLM inference client
docs/        architecture notes & feature specs
```

## Quick start

### Backend

```sh
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8787
```

Requires a local inference server (default: [Ollama](https://ollama.com) with
`llama3.1:8b`) or set `OPENROUTER_API_KEY` for hosted fallback. See `backend/README.md`.

### Extension

```sh
cd extension
npm install
npm run dev      # vite build --watch
```

Then load `extension/dist/` as an unpacked extension at `chrome://extensions`
(Developer mode → "Load unpacked") and open a battle on https://play.pokemonshowdown.com.

## Data flow

```
Showdown page (app.room / battle log)
  └─ injected.js  (page context: hooks the battle room's message stream)
      └─ content.ts  (extension context: relays via postMessage → chrome.runtime)
          └─ background.ts  (websocket ws://localhost:8787/ws/battle)
              └─ FastAPI backend
                  ├─ protocol parse + damage calc features
                  ├─ Bayesian opponent model (PokéChamp)
                  └─ LLM value function (Llama 3.1 8B via Ollama/vLLM)
          ┌─ advice frames stream back over the same socket
  └─ overlay React app renders win-con tags + pathway panel
```

## Design constraints

- Showdown's battle timer allots ~150 s total; advice must land in **< 5 s per turn**.
- The extension must never act for the player (no automated moves) — advice only,
  to stay on the right side of Showdown's rules, like Showdex.
- All state parsing happens against the documented protocol
  (`pokemon-showdown/PROTOCOL.md`, `sim/SIM-PROTOCOL.md`) via `@pkmn/protocol`.
