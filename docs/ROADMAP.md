# Roadmap

## M0 — Plumbing (current)
- [x] Repo scaffold: MV3 extension (Vite/React/TS) + FastAPI backend
- [x] Page-hook → content → background → websocket data path
- [x] Protocol chunk parsing on both sides
- [x] End-to-end smoke test (2026-07-27, vs. play.pokemonshowdown.com from Brave via SSH
      tunnel — heuristic fallback frames rendering per turn; LLM scoring not yet live)

## M1 — Win-Condition Analyzer v1
- [ ] Counterfactual value scoring with Ollama llama3.1:8b (`wincon.py` already wired)
- [ ] Anchor tags onto the battle UI switch menu instead of the floating panel
- [ ] Cache scores between turns; only re-score after state-changing events
- [ ] Precompute during opponent's decision time ("thinking on opponent's clock")

## M2 — Opponent model + client-side calcs
- [x] PokéChamp Bayesian predictor as a sidecar service (`backend/predictor_service.py`,
      :8790, runs in pokechamp's env; trained on 25k gen9ou teams, 2026-07-27) —
      unrevealed teammates + likely sets now ship in every AdviceFrame
- [x] Client-side damage annotations via @smogon/calc (`extension/src/lib/calc.ts`) —
      our moves vs. their active and their revealed moves vs. us, no backend round-trip
- [x] ~~Speed-tier strip~~ — removed 2026-07-27, min/max ranges were too vague to act on
- [x] Damage calc uses real sets: our true stats/item/ability from |request|, opponent's
      predicted nature/EVs/item from the Bayesian model (not 0-EV guesses)
- [x] Overlay anchors below battle controls; hidden outside battles, clears on |win|/|tie|
- [ ] Feed predicted sets into the LLM value prompt (needs LLM serving)
- [ ] Show top-3 predicted opponent *actions* (move-level) with probabilities

## M3 — Pathway search
- [ ] Shallow (depth-2) minimax over LLM-sampled candidate actions, PokéChamp-style,
      populating `AdviceFrame.pathway`
- [ ] Distill: fine-tune a small value model on pokechamp HF dataset
      (https://huggingface.co/datasets/milkkarten/pokechamp) states labeled with
      final battle outcome, replacing prompted scoring with a single fast forward pass

## M4 — Product polish
- [ ] Post-game "turning point" review (biggest win-prob swings)
- [ ] Settings popup (backend URL, model, feature toggles)
- [ ] Chrome Web Store packaging
