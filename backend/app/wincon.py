"""Win-Condition / Game-Tree Pathway Analyzer.

Core idea (adapted from PokéChamp's tree_search in pokechamp/llm_player.py):
for each benched Pokémon M, compare the game value of the subtree where M is
preserved against the subtree where M is sacrificed. The gap between those two
win probabilities is M's "win-con weight":

    weight(M) = V(state | M preserved) - V(state | M lost)

  weight > TAG_MUST_PRESERVE_DELTA  -> MUST_PRESERVE   (M is a win condition)
  weight < TAG_SAFE_DELTA           -> SAFE_TO_SACRIFICE
  otherwise                         -> FLEXIBLE

V(state) is PokéChamp's Value Function Estimation: an LLM scores the position
1-100 ("how likely is the player to win"), with a fast heuristic fallback
(HP differential + matchup spread) when the LLM budget is exhausted. Per-turn
latency budget is enforced by `INFERENCE_DEADLINE_S`; whatever isn't scored in
time falls back to the heuristic so an AdviceFrame always ships.
"""
from __future__ import annotations

import asyncio

from pydantic import BaseModel, Field

from app.battle_state import BattleTracker, MonState
from app.inference import score_position
from app.opponent_model import OpponentIntel, predict_opponent

TAG_MUST_PRESERVE_DELTA = 0.15
TAG_SAFE_DELTA = 0.05
INFERENCE_DEADLINE_S = 4.0


class PokemonAssessment(BaseModel):
    species: str
    tag: str
    win_prob_if_lost: float = Field(alias="winProbIfLost")
    win_prob_if_preserved: float = Field(alias="winProbIfPreserved")
    reason: str

    model_config = {"populate_by_name": True}


class PathwayStep(BaseModel):
    turn: int
    action: str
    rationale: str


class AdviceFrame(BaseModel):
    roomid: str
    turn: int
    overall_win_prob: float = Field(alias="overallWinProb")
    assessments: list[PokemonAssessment]
    pathway: list[PathwayStep]
    opponent: OpponentIntel = OpponentIntel()
    latency_ms: int = Field(default=0, alias="latencyMs")

    model_config = {"populate_by_name": True}


async def analyze_win_conditions(tracker: BattleTracker) -> AdviceFrame:
    """Score the current position and the counterfactual 'mon M is gone' positions."""
    bench = tracker.bench()

    async def with_deadline(coro):
        try:
            return await asyncio.wait_for(coro, timeout=INFERENCE_DEADLINE_S)
        except Exception as exc:  # timeout, LLM server down, bad response — heuristic takes over
            print(f"[wincon] LLM scoring unavailable ({type(exc).__name__}: {exc}); using heuristic")
            return None

    opponent_intel, base, *counterfactuals = await asyncio.gather(
        predict_opponent(tracker),
        with_deadline(score_position(tracker, removed=None)),
        *[with_deadline(score_position(tracker, removed=mon.species)) for mon in bench],
    )
    base_v = base if base is not None else _heuristic_value(tracker, removed=None)

    assessments = []
    for mon, cf in zip(bench, counterfactuals):
        lost_v = cf if cf is not None else _heuristic_value(tracker, removed=mon.species)
        weight = base_v - lost_v
        if weight > TAG_MUST_PRESERVE_DELTA:
            tag, reason = "MUST_PRESERVE", f"Losing {mon.species} drops win% by {weight:.0%}"
        elif weight < TAG_SAFE_DELTA:
            tag, reason = "SAFE_TO_SACRIFICE", f"{mon.species} contributes little to remaining lines"
        else:
            tag, reason = "FLEXIBLE", f"{mon.species} is situationally useful"
        assessments.append(
            PokemonAssessment(
                species=mon.species,
                tag=tag,
                win_prob_if_lost=round(lost_v, 3),
                win_prob_if_preserved=round(base_v, 3),
                reason=reason,
            )
        )

    return AdviceFrame(
        roomid=tracker.roomid,
        turn=tracker.turn,
        overall_win_prob=round(base_v, 3),
        assessments=assessments,
        pathway=[],  # populated once the shallow minimax pathway search lands
        opponent=opponent_intel,
    )


def _heuristic_value(tracker: BattleTracker, removed: str | None) -> float:
    """PokéChamp's fallback value function (LocalSim.get_hp_diff analog):
    normalized HP differential across both teams, in [0, 1]."""

    def team_hp(mons: dict[str, MonState], skip: str | None) -> float:
        return sum(m.hp_fraction for name, m in mons.items() if name != skip)

    if tracker.player_side is None:
        return 0.5
    ours = team_hp(tracker.mons[tracker.player_side], removed)
    theirs = team_hp(tracker.mons[tracker.opponent_side], None)
    return max(0.0, min(1.0, 0.5 + (ours - theirs) / 12.0))
