"""LLM value-function client.

Default target is a local OpenAI-compatible server (Ollama at :11434, or vLLM)
running a small fast model — Llama 3.1 8B class. The prompt is a direct port of
PokéChamp's leaf-node value prompt (pokechamp/llm_player.py::tree_search).

Set POKE_COPILOT_MODEL / POKE_COPILOT_BASE_URL to switch backends, e.g.:
  POKE_COPILOT_BASE_URL=http://localhost:11434/v1  POKE_COPILOT_MODEL=llama3.1:8b
"""
from __future__ import annotations

import json
import os

import httpx

from app.battle_state import BattleTracker

BASE_URL = os.environ.get("POKE_COPILOT_BASE_URL", "http://localhost:11434/v1")
MODEL = os.environ.get("POKE_COPILOT_MODEL", "llama3.1:8b")
# For hosted OpenAI-compatible endpoints (OpenRouter etc.); local servers ignore it.
API_KEY = os.environ.get("POKE_COPILOT_API_KEY", "")

VALUE_PROMPT = (
    "Evaluate the score from 1-100 based on how likely the player is to win. "
    "Higher is better. Start at 50 points. "
    "Add points based on the effectiveness of current available moves. "
    "Award points for each pokemon remaining on the player's team, weighted by their strength. "
    "Add points for boosted status and opponent entry hazards and subtract points for status "
    "effects and player entry hazards. "
    "Subtract points based on the effectiveness of the opponent's current moves, especially if "
    "they have a faster speed. "
    "Remove points for each pokemon remaining on the opponent's team, weighted by their strength. "
    'Respond ONLY with JSON: {"score": <int 1-100>}'
)

_client = httpx.AsyncClient(timeout=10.0)


def _serialize_state(tracker: BattleTracker, removed: str | None) -> str:
    """Compact battle-state → text translation (PokéChamp prompts.state_translate analog)."""
    lines = [f"Turn {tracker.turn}."]
    for side_id, side_label in ((tracker.player_side, "Player"), (tracker.opponent_side, "Opponent")):
        if side_id is None:
            continue
        for mon in tracker.mons[side_id].values():
            if mon.species == removed and side_label == "Player":
                continue  # counterfactual: this mon has been lost
            if mon.fainted:
                lines.append(f"{side_label} {mon.species}: FAINTED")
                continue
            status = f" status:{mon.status}" if mon.status else ""
            active = " (active)" if mon.is_active else ""
            moves = f" moves:{','.join(mon.revealed_moves)}" if mon.revealed_moves else ""
            lines.append(f"{side_label} {mon.species}{active}: {mon.hp_fraction:.0%} HP{status}{moves}")
    for side_id, label in (("p1", "p1"), ("p2", "p2")):
        if tracker.hazards[side_id]:
            lines.append(f"Hazards on {label}: {', '.join(tracker.hazards[side_id])}")
    if removed:
        lines.append(f"NOTE: Player has just lost {removed}.")
    return "\n".join(lines)


async def score_position(tracker: BattleTracker, removed: str | None) -> float:
    """Return estimated win probability in [0, 1] via LLM 1-100 score."""
    state = _serialize_state(tracker, removed)
    resp = await _client.post(
        f"{BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {API_KEY}"} if API_KEY else {},
        json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": "You are a competitive Pokemon battle expert."},
                {"role": "user", "content": f"{state}\n\n{VALUE_PROMPT}"},
            ],
            "temperature": 0.3,
            "max_tokens": 30,
            "response_format": {"type": "json_object"},
        },
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    score = int(json.loads(content)["score"])
    return max(0.0, min(1.0, score / 100.0))
