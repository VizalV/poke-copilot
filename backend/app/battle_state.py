"""Server-side battle state tracking from raw Showdown protocol chunks.

This is the Python mirror of the extension's lightweight parser, but complete
enough to feed the win-con analyzer: species, HP fractions, statuses, hazards,
revealed moves, and the player's full team from |request| payloads.

PokéChamp's `poke_env.environment.Battle` does exactly this for its own agent;
the plan is to reuse it here (pokechamp is a sibling repo / future dependency)
rather than reimplementing the protocol. For now this class holds the minimal
fields the analyzer needs, parsed directly.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field


@dataclass
class MonState:
    species: str
    hp_fraction: float = 1.0
    status: str | None = None
    revealed_moves: list[str] = field(default_factory=list)
    is_active: bool = False


class BattleTracker:
    def __init__(self, roomid: str) -> None:
        self.roomid = roomid
        self.turn = 0
        self.player_side: str | None = None  # "p1"/"p2", learned from |request|
        self.mons: dict[str, dict[str, MonState]] = {"p1": {}, "p2": {}}
        self.hazards: dict[str, list[str]] = {"p1": [], "p2": []}
        self.request_json: dict | None = None

    # -- protocol ingestion ------------------------------------------------

    def ingest_chunk(self, chunk: str) -> bool:
        """Feed a protocol chunk; returns True when a decision point was reached
        (|turn| or forced switch), i.e. time to run analysis."""
        decision_point = False
        for line in chunk.split("\n"):
            parts = line.split("|")
            if len(parts) < 2:
                continue
            cmd, args = parts[1], parts[2:]
            if cmd == "turn":
                self.turn = int(args[0])
                decision_point = True
            elif cmd in ("switch", "drag"):
                self._on_switch(args)
            elif cmd in ("-damage", "-heal"):
                self._on_hp(args)
            elif cmd == "move":
                self._on_move(args)
            elif cmd == "faint":
                self._on_faint(args)
            elif cmd == "-sidestart":
                side = "p1" if args[0].startswith("p1") else "p2"
                self.hazards[side].append(args[1])
        return decision_point

    def ingest_request(self, request: str) -> None:
        """|request| JSON contains our full team (incl. unrevealed) and legal actions."""
        if not request:
            return
        self.request_json = json.loads(request)
        side = self.request_json.get("side", {})
        if side.get("id"):
            self.player_side = side["id"]
        for mon in side.get("pokemon", []):
            species = mon["details"].split(",")[0]
            state = self.mons[self.player_side].setdefault(species, MonState(species))
            state.is_active = bool(mon.get("active"))
            state.revealed_moves = mon.get("moves", [])

    # -- helpers -----------------------------------------------------------

    @staticmethod
    def _side_and_name(ident: str) -> tuple[str, str]:
        side = "p1" if ident.startswith("p1") else "p2"
        name = ident.split(": ", 1)[1] if ": " in ident else ident
        return side, name

    @staticmethod
    def _hp_fraction(hp_status: str) -> float:
        hp = hp_status.split(" ")[0]
        if hp == "0" or "fnt" in hp_status:
            return 0.0
        cur, _, maxhp = hp.partition("/")
        return int(cur) / int(maxhp) if maxhp else 1.0

    def _on_switch(self, args: list[str]) -> None:
        side, _ = self._side_and_name(args[0])
        species = args[1].split(",")[0]
        for mon in self.mons[side].values():
            mon.is_active = False
        state = self.mons[side].setdefault(species, MonState(species))
        state.is_active = True
        if len(args) > 2:
            state.hp_fraction = self._hp_fraction(args[2])

    def _on_hp(self, args: list[str]) -> None:
        side, species = self._side_and_name(args[0])
        if species in self.mons[side] and len(args) > 1:
            self.mons[side][species].hp_fraction = self._hp_fraction(args[1])

    def _on_move(self, args: list[str]) -> None:
        side, species = self._side_and_name(args[0])
        state = self.mons[side].setdefault(species, MonState(species))
        if len(args) > 1 and args[1] not in state.revealed_moves:
            state.revealed_moves.append(args[1])

    def _on_faint(self, args: list[str]) -> None:
        side, species = self._side_and_name(args[0])
        if species in self.mons[side]:
            self.mons[side][species].hp_fraction = 0.0

    # -- views -------------------------------------------------------------

    @property
    def opponent_side(self) -> str:
        return "p2" if self.player_side == "p1" else "p1"

    def bench(self) -> list[MonState]:
        if self.player_side is None:
            return []
        return [m for m in self.mons[self.player_side].values() if not m.is_active and m.hp_fraction > 0]
