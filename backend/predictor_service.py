"""Bayesian opponent-model sidecar.

Wraps PokéChamp's PokemonPredictor (bayesian/) behind a tiny HTTP API. Runs
inside the *pokechamp* environment (its vendored poke_env fork + trained cache),
keeping those heavyweight deps out of the main backend venv:

    cd /common/users/vv382/pokechamp
    METAMON_CACHE_DIR=/common/users/vv382/metamon_cache \
      uv run --with fastapi --with "uvicorn[standard]" \
      python /common/users/vv382/poke-copilot/backend/predictor_service.py

First run downloads the gen9ou team set from HuggingFace and trains the model
(several minutes); afterwards it loads the cached .pkl in seconds.

The main backend (app/opponent_model.py) calls POST /predict per turn.
"""
from __future__ import annotations

import os
import sys

os.environ.setdefault("METAMON_CACHE_DIR", "/common/users/vv382/metamon_cache")
POKECHAMP_DIR = os.environ.get("POKECHAMP_DIR", "/common/users/vv382/pokechamp")
sys.path.insert(0, POKECHAMP_DIR)

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="poke-copilot-predictor")
_predictor = None


def get_predictor():
    global _predictor
    if _predictor is None:
        from bayesian.pokemon_predictor import PokemonPredictor

        _predictor = PokemonPredictor(battle_format="gen9ou")
    return _predictor


class PredictRequest(BaseModel):
    revealed: list[str]
    observed_moves: dict[str, list[str]] = {}
    max_teammates: int = 4
    max_moves: int = 4


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "model_loaded": _predictor is not None}


@app.post("/predict")
def predict(req: PredictRequest) -> dict:
    p = get_predictor()
    teammates = [
        {"species": s, "probability": round(prob, 4)}
        for s, prob in p.predict_teammates(req.revealed, max_predictions=req.max_teammates)
    ]
    sets: dict[str, dict] = {}
    for species in req.revealed:
        try:
            probs = p.predict_component_probabilities(
                species,
                teammates=[s for s in req.revealed if s != species],
                observed_moves=req.observed_moves.get(species) or None,
            )
            if "error" in probs:
                continue
            sets[species] = _top_components(probs, req.max_moves)
        except Exception:
            continue  # unseen species (rare formats/nicknames) — skip quietly
    return {"teammates": teammates, "sets": sets}


def _top_components(probs: dict, max_moves: int) -> dict:
    """Reduce (name, prob)-pair lists to the top few of each component."""

    def top(pairs, n=1):
        return [{"name": k, "probability": round(v, 4)} for k, v in (pairs or [])[:n]]

    return {
        "moves": top(probs.get("moves"), max_moves),
        "item": top(probs.get("items")),
        "ability": top(probs.get("abilities")),
        "nature": top(probs.get("natures")),
        "ev_spread": top(probs.get("ev_spreads")),
    }


if __name__ == "__main__":
    get_predictor()  # load/train eagerly at startup, not on first request
    uvicorn.run(app, host="127.0.0.1", port=8790)
