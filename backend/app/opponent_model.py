"""Client for the Bayesian predictor sidecar (predictor_service.py).

The sidecar runs in pokechamp's environment on :8790 and answers with
predicted unrevealed teammates + likely sets for revealed opponent Pokémon.
Unavailable sidecar → empty predictions; never blocks the advice frame.
"""
from __future__ import annotations

import os

import httpx
from pydantic import BaseModel, Field

from app.battle_state import BattleTracker

PREDICTOR_URL = os.environ.get("POKE_COPILOT_PREDICTOR_URL", "http://localhost:8790")

_client = httpx.AsyncClient(timeout=3.0)


class ComponentGuess(BaseModel):
    name: str
    probability: float


class OpponentSet(BaseModel):
    species: str
    moves: list[ComponentGuess] = []
    item: list[ComponentGuess] = []
    ability: list[ComponentGuess] = []
    ev_spread: list[ComponentGuess] = Field(default=[], alias="evSpread")

    model_config = {"populate_by_name": True}


class OpponentIntel(BaseModel):
    """Predicted hidden information about the opponent's team."""

    unrevealed: list[ComponentGuess] = []  # likely teammates not yet seen
    sets: list[OpponentSet] = []           # likely builds of revealed mons

    model_config = {"populate_by_name": True}


async def predict_opponent(tracker: BattleTracker) -> OpponentIntel:
    revealed = [m.species for m in tracker.mons[tracker.opponent_side].values()]
    if not revealed or tracker.player_side is None:
        return OpponentIntel()
    observed_moves = {
        m.species: m.revealed_moves
        for m in tracker.mons[tracker.opponent_side].values()
        if m.revealed_moves
    }
    try:
        resp = await _client.post(
            f"{PREDICTOR_URL}/predict",
            json={"revealed": revealed, "observed_moves": observed_moves},
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        print(f"[opponent] predictor sidecar unavailable ({type(exc).__name__}); skipping intel")
        return OpponentIntel()

    return OpponentIntel(
        unrevealed=[
            ComponentGuess(name=t["species"], probability=t["probability"])
            for t in data.get("teammates", [])
        ],
        sets=[
            OpponentSet(species=species, **components)
            for species, components in data.get("sets", {}).items()
        ],
    )
