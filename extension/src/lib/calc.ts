/**
 * Client-side damage annotations and speed tiers via @smogon/calc.
 *
 * Accuracy notes (v1): our own item/ability/level come from |request|, but EV
 * spreads are unknown for both sides, so calcs use neutral 0-EV sets — treat
 * percentages as estimates. Speed uses our TRUE stat (from |request|) against
 * the opponent's theoretical min (0 EV neutral) / max (252 EV, +nature) roll.
 * Boosts, screens, weather, and items like Choice Scarf are not yet modeled.
 */
import { calculate, Generations, Move, Pokemon } from '@smogon/calc';

import type { BattleSnapshot } from './protocol';
import type { LocalAnalysis, MoveAnnotation, SpeedRow, SpeedVerdict } from './types';

const gen = Generations.get(9);

export function analyzeLocally(snap: BattleSnapshot): LocalAnalysis {
  const us = snap.playerSide;
  const them = us === 'p1' ? 'p2' : 'p1';
  const empty: LocalAnalysis = {
    roomid: snap.roomid,
    ourActive: null,
    oppActive: null,
    ourMoves: [],
    theirMoves: [],
    ourSpeed: null,
    speedTiers: [],
  };
  if (!us || !snap.request) return empty;

  const ourActive = snap[us].active;
  const oppActive = snap[them].active;
  const ourReqMon = snap.request.side.pokemon.find((p) => p.active);

  const analysis: LocalAnalysis = {
    ...empty,
    ourActive,
    oppActive,
    ourSpeed: ourReqMon?.stats.spe ?? null,
  };

  // --- damage annotations (both directions, vs. the two actives) ----------
  if (ourActive && oppActive && ourReqMon) {
    const ourLevel = levelOf(snap, us, ourActive);
    const oppLevel = levelOf(snap, them, oppActive);
    const attacker = safePokemon(ourActive, {
      level: ourLevel,
      item: ourReqMon.item,
      ability: ourReqMon.ability,
    });
    const defender = safePokemon(oppActive, { level: oppLevel });
    if (attacker && defender) {
      const ourMoveNames =
        snap.request.active?.[0]?.moves.filter((m) => !m.disabled).map((m) => m.move) ??
        ourReqMon.moves;
      analysis.ourMoves = annotateMoves(ourMoveNames, attacker, defender);
      analysis.theirMoves = annotateMoves(
        snap[them].mons[oppActive]?.revealedMoves ?? [],
        defender,
        attacker,
      );
    }
  }

  // --- speed tiers: our active's true speed vs. every revealed opp mon ----
  if (analysis.ourSpeed != null) {
    analysis.speedTiers = Object.values(snap[them].mons)
      .filter((m) => m.hpFraction > 0)
      .map((m) => speedRow(m.species, m.level, analysis.ourSpeed!))
      .filter((row): row is SpeedRow => row !== null)
      .sort((a, b) => b.maxSpe - a.maxSpe);
  }

  return analysis;
}

function levelOf(snap: BattleSnapshot, side: 'p1' | 'p2', species: string): number {
  return snap[side].mons[species]?.level ?? 100;
}

function safePokemon(species: string, opts: ConstructorParameters<typeof Pokemon>[2]): Pokemon | null {
  try {
    return new Pokemon(gen, species, opts);
  } catch {
    return null; // species string the calc data doesn't know (rare forms)
  }
}

function annotateMoves(moveNames: string[], attacker: Pokemon, defender: Pokemon): MoveAnnotation[] {
  const out: MoveAnnotation[] = [];
  for (const name of moveNames) {
    try {
      const result = calculate(gen, attacker, defender, new Move(gen, name));
      const [min, max] = result.range();
      const maxHP = defender.maxHP();
      let koChance = '';
      try {
        if (max > 0) koChance = result.kochance().text;
      } catch {
        /* kochance throws on 0-damage results */
      }
      out.push({
        move: name,
        minPct: Math.round((min / maxHP) * 1000) / 10,
        maxPct: Math.round((max / maxHP) * 1000) / 10,
        koChance,
      });
    } catch {
      continue; // status moves with odd data, unknown moves, etc.
    }
  }
  return out.sort((a, b) => b.maxPct - a.maxPct);
}

function speedRow(species: string, level: number, ourSpeed: number): SpeedRow | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @smogon/calc wants its branded ID type
  const data = gen.species.get(toID(species) as any);
  if (!data) return null;
  const base = data.baseStats.spe;
  // Standard stat formulas at 31 IV: min = 0 EV neutral, max = 252 EV +nature.
  const minSpe = Math.floor(((2 * base + 31) * level) / 100 + 5);
  const maxSpe = Math.floor((Math.floor(((2 * base + 31 + 63) * level) / 100 + 5)) * 1.1);
  const verdict: SpeedVerdict = ourSpeed > maxSpe ? 'FASTER' : ourSpeed < minSpe ? 'SLOWER' : 'RANGE';
  return { species, minSpe, maxSpe, verdict };
}

function toID(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
