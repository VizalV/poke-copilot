"""Server-side battle state tracking from raw Showdown protocol chunks.

This is the Python mirror of the extension's lightweight parser, but complete
enough to feed the win-con analyzer: species, HP fractions, statuses, hazards,
revealed moves, and the player's full team from |request| payloads.

Protocol idents carry the *nickname* ("p1a: Sparky") while |switch| details
carry the *species* ("Jolteon, L84, M"), and for alternate formes the ident
uses the base name ("p2a: Slowking" for Slowking-Galar). Everything is keyed by
species, so every ident is resolved through a per-side nickname map before use;
without that, faints and damage silently missed their target and nicknames
appeared as phantom Pokemon.
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

    @property
    def fainted(self) -> bool:
        return self.hp_fraction <= 0


class BattleTracker:
    def __init__(self, roomid: str) -> None:
        self.roomid = roomid
        self.turn = 0
        self.player_side: str | None = None  # "p1"/"p2", learned from |request|
        self.mons: dict[str, dict[str, MonState]] = {"p1": {}, "p2": {}}
        self.hazards: dict[str, list[str]] = {"p1": [], "p2": []}
        # (side) -> {nickname/ident name: species}
        self.nicknames: dict[str, dict[str, str]] = {"p1": {}, "p2": {}}
        self.request_json: dict | None = None

    # -- protocol ingestion ------------------------------------------------

    def ingest_chunk(self, chunk: str) -> bool:
        """Feed a protocol chunk; returns True when a decision point was reached
        (|turn|), i.e. time to run analysis."""
        decision_point = False
        for line in chunk.split("\n"):
            parts = line.split("|")
            if len(parts) < 2:
                continue
            cmd, args = parts[1], parts[2:]
            if not args:
                continue
            if cmd == "turn":
                self.turn = int(args[0])
                decision_point = True
            elif cmd in ("switch", "drag"):
                self._on_switch(args)
            elif cmd in ("detailschange", "replace", "-formechange"):
                self._on_forme_change(args)
            elif cmd in ("-damage", "-heal", "-sethp"):
                self._on_hp(args)
            elif cmd == "move":
                self._on_move(args)
            elif cmd == "faint":
                self._on_faint(args)
            elif cmd == "-status":
                self._on_status(args, args[1] if len(args) > 1 else None)
            elif cmd == "-curestatus":
                self._on_status(args, None)
            elif cmd == "-sidestart":
                side = "p1" if args[0].startswith("p1") else "p2"
                if len(args) > 1 and args[1] not in self.hazards[side]:
                    self.hazards[side].append(args[1])
            elif cmd == "-sideend":
                side = "p1" if args[0].startswith("p1") else "p2"
                if len(args) > 1 and args[1] in self.hazards[side]:
                    self.hazards[side].remove(args[1])
        return decision_point

    def ingest_request(self, request: str) -> None:
        """|request| JSON contains our full team (incl. unrevealed) and legal actions."""
        if not request:
            return
        self.request_json = json.loads(request)
        side = self.request_json.get("side", {})
        if side.get("id"):
            self.player_side = side["id"]
        if self.player_side is None:
            return
        for mon in side.get("pokemon", []):
            species = mon["details"].split(",")[0]
            # "p1: Sparky" -> remember the nickname for this species.
            ident_name = mon.get("ident", "").split(": ", 1)[-1]
            if ident_name:
                self.nicknames[self.player_side][ident_name] = species
            state = self.mons[self.player_side].setdefault(species, MonState(species))
            state.is_active = bool(mon.get("active"))
            state.revealed_moves = mon.get("moves", [])
            if mon.get("condition"):
                state.hp_fraction = self._hp_fraction(mon["condition"])

    # -- ident resolution --------------------------------------------------

    @staticmethod
    def _side_of(ident: str) -> str:
        return "p1" if ident.startswith("p1") else "p2"

    def _resolve(self, ident: str) -> tuple[str, str | None]:
        """Map a protocol ident ("p1a: Sparky") to (side, species)."""
        side = self._side_of(ident)
        name = ident.split(": ", 1)[1] if ": " in ident else ident
        species = self.nicknames[side].get(name)
        if species:
            return side, species
        if name in self.mons[side]:  # un-nicknamed: ident name is the species
            return side, name
        # Unknown ident (we missed the switch): fall back to whoever is active.
        for candidate in self.mons[side].values():
            if candidate.is_active:
                return side, candidate.species
        return side, None

    @staticmethod
    def _hp_fraction(hp_status: str) -> float:
        hp = hp_status.split(" ")[0]
        if hp == "0" or "fnt" in hp_status:
            return 0.0
        cur, _, maxhp = hp.partition("/")
        try:
            return int(cur) / int(maxhp) if maxhp else 1.0
        except ValueError:
            return 1.0

    # -- handlers ----------------------------------------------------------

    def _on_switch(self, args: list[str]) -> None:
        side = self._side_of(args[0])
        nickname = args[0].split(": ", 1)[1] if ": " in args[0] else args[0]
        species = args[1].split(",")[0]
        self.nicknames[side][nickname] = species
        for mon in self.mons[side].values():
            mon.is_active = False
        state = self.mons[side].setdefault(species, MonState(species))
        state.is_active = True
        if len(args) > 2:
            state.hp_fraction = self._hp_fraction(args[2])

    def _on_forme_change(self, args: list[str]) -> None:
        """Slowking -> Slowking-Galar etc.: re-point the nickname at the new species."""
        side = self._side_of(args[0])
        nickname = args[0].split(": ", 1)[1] if ": " in args[0] else args[0]
        new_species = args[1].split(",")[0]
        _, old_species = self._resolve(args[0])
        old = self.mons[side].pop(old_species, None) if old_species else None
        state = self.mons[side].setdefault(new_species, MonState(new_species))
        if old:
            state.hp_fraction = old.hp_fraction
            state.status = old.status
            state.is_active = old.is_active
            for mv in old.revealed_moves:
                if mv not in state.revealed_moves:
                    state.revealed_moves.append(mv)
        self.nicknames[side][nickname] = new_species

    def _on_hp(self, args: list[str]) -> None:
        side, species = self._resolve(args[0])
        if species and species in self.mons[side] and len(args) > 1:
            self.mons[side][species].hp_fraction = self._hp_fraction(args[1])

    def _on_move(self, args: list[str]) -> None:
        side, species = self._resolve(args[0])
        if not species:
            return
        state = self.mons[side].setdefault(species, MonState(species))
        if len(args) > 1 and args[1] and args[1] not in state.revealed_moves:
            state.revealed_moves.append(args[1])

    def _on_faint(self, args: list[str]) -> None:
        side, species = self._resolve(args[0])
        if species and species in self.mons[side]:
            self.mons[side][species].hp_fraction = 0.0
            self.mons[side][species].is_active = False

    def _on_status(self, args: list[str], status: str | None) -> None:
        side, species = self._resolve(args[0])
        if species and species in self.mons[side]:
            self.mons[side][species].status = status

    # -- views -------------------------------------------------------------

    @property
    def opponent_side(self) -> str:
        return "p2" if self.player_side == "p1" else "p1"

    def bench(self) -> list[MonState]:
        """Our living, non-active Pokemon — the ones the win-con tags apply to."""
        if self.player_side is None:
            return []
        return [m for m in self.mons[self.player_side].values() if not m.is_active and not m.fainted]

    def living_opponents(self) -> list[MonState]:
        return [m for m in self.mons[self.opponent_side].values() if not m.fainted]
