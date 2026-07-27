# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Poké-Copilot: a Chrome MV3 extension + FastAPI backend giving competitive Pokémon Showdown
players real-time AI analysis. Flagship feature: the Win-Condition Analyzer, which tags each
benched Pokémon MUST_PRESERVE / FLEXIBLE / SAFE_TO_SACRIFICE by comparing LLM-estimated win
probabilities for "mon preserved" vs. "mon lost" counterfactual states (see
`backend/app/wincon.py` docstring). The value-function prompt is ported from PokéChamp
(`../pokechamp/pokechamp/llm_player.py`, `tree_search` leaf evaluation).

## Commands

```sh
# extension/ — React + TS + Vite, builds MV3 bundle into extension/dist/
npm install && npm run dev        # watch build; load dist/ as unpacked extension
npm run build                     # typecheck + production build
npm test                          # vitest

# backend/ — Python 3.11+, uv
uv sync
uv run uvicorn app.main:app --reload --port 8787
uv run pytest
```

Inference expects an OpenAI-compatible server (Ollama `llama3.1:8b` by default);
configure via `POKE_COPILOT_BASE_URL` / `POKE_COPILOT_MODEL`.

## Architecture invariants

- Data path: `injected.js` (page world, hooks Showdown's `app.rooms[*].receive`) →
  `content.ts` (postMessage relay) → `background.ts` (single websocket to backend) →
  `AdviceFrame` back to the overlay. The message contracts live in
  `extension/src/lib/types.ts` and must stay mirrored with the Pydantic models in
  `backend/app/wincon.py` (camelCase on the wire via aliases).
- The extension is advice-only: nothing in page context may ever send a battle choice.
- Every turn must produce an AdviceFrame within the deadline (`INFERENCE_DEADLINE_S`);
  LLM calls that miss it fall back to the HP-differential heuristic, never block.
- The player's own unrevealed team comes only from `|request|` payloads (page side);
  the opponent's hidden information must come from prediction, never from cheating.
- Opponent intel comes from `backend/predictor_service.py`, a sidecar wrapping
  PokéChamp's Bayesian predictor that must run inside the *pokechamp* repo's env
  (see backend/README.md); `app/opponent_model.py` degrades to empty intel if it's down.
- Damage/speed annotations are computed client-side in `extension/src/lib/calc.ts`
  (@smogon/calc, 0-EV estimates) — they must never require a backend round-trip.
