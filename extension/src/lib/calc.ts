/**
 * Client-side damage annotations via @smogon/calc.
 *
 * Accuracy comes from two sources rather than guessing:
 *  - our side uses the TRUE final stats, item and ability from |request|
 *  - the opponent uses the Bayesian predictor's most likely nature / EV spread
 *    / item / ability (from the backend's AdviceFrame), falling back to a
 *    neutral 0-EV set before the first prediction arrives.
 *
 * Not yet modelled: boosts, screens, weather/terrain, Tera.
 */
import { calculate, Generations, Move, Pokemon } from '@smogon/calc';

import type { BattleSnapshot, RequestPokemon } from './protocol';
import type { LocalAnalysis, MoveAnnotation, OpponentSet } from './types';

const gen = Generations.get(9);

const STAT_KEYS: Record<string, string> = {
  HP: 'hp',
  Atk: 'atk',
  Def: 'def',
  SpA: 'spa',
  SpD: 'spd',
  Spe: 'spe',
};

export function analyzeLocally(snap: BattleSnapshot, predictedSets: OpponentSet[] = []): LocalAnalysis {
  const us = snap.playerSide;
  const them = us === 'p1' ? 'p2' : 'p1';
  const empty: LocalAnalysis = {
    roomid: snap.roomid,
    ourActive: null,
    oppActive: null,
    ourMoves: [],
    theirMoves: [],
    oppSetLabel: null,
  };
  if (!us || !snap.request) return empty;

  const ourActive = snap[us].active;
  const oppActive = snap[them].active;
  const ourReqMon = snap.request.side.pokemon.find((p) => p.active);
  if (!ourActive || !oppActive || !ourReqMon) return { ...empty, ourActive, oppActive };

  const predicted = predictedSets.find((s) => s.species === oppActive);
  const attacker = buildOurMon(ourActive, snap[us].mons[ourActive]?.level ?? 100, ourReqMon);
  const defender = buildOppMon(oppActive, snap[them].mons[oppActive]?.level ?? 100, predicted);
  if (!attacker || !defender) return { ...empty, ourActive, oppActive };

  const ourMoveNames =
    snap.request.active?.[0]?.moves.filter((m) => !m.disabled).map((m) => m.move) ?? ourReqMon.moves;

  return {
    roomid: snap.roomid,
    ourActive,
    oppActive,
    ourMoves: annotateMoves(ourMoveNames, attacker, defender),
    theirMoves: annotateMoves(snap[them].mons[oppActive]?.revealedMoves ?? [], defender, attacker),
    oppSetLabel: describeSet(predicted),
  };
}

/** Our side: exact stats straight from |request|, so percentages are real. */
function buildOurMon(species: string, level: number, req: RequestPokemon): Pokemon | null {
  const mon = safePokemon(species, { level, item: req.item, ability: req.ability });
  if (!mon) return null;
  const maxHP = Number(req.condition.split(' ')[0].split('/')[1]);
  Object.assign(mon.stats, req.stats);
  if (Number.isFinite(maxHP) && maxHP > 0) mon.stats.hp = maxHP;
  return mon;
}

/** Opponent: predicted set if the backend has one, else neutral 0 EVs. */
function buildOppMon(species: string, level: number, set?: OpponentSet): Pokemon | null {
  const opts: Record<string, unknown> = { level };
  if (set) {
    if (set.item[0]) opts.item = set.item[0].name;
    if (set.ability[0]) opts.ability = set.ability[0].name;
    if (set.nature?.[0]) opts.nature = set.nature[0].name;
    const evs = parseEVs(set.evSpread?.[0]?.name);
    if (evs) opts.evs = evs;
  }
  return safePokemon(species, opts) ?? safePokemon(species, { level });
}

/** "252 Atk / 252 Spe" -> { atk: 252, spe: 252 } */
function parseEVs(spread?: string): Record<string, number> | null {
  if (!spread || spread.startsWith('No major')) return null;
  const evs: Record<string, number> = {};
  for (const part of spread.split('/')) {
    const m = part.trim().match(/^(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)$/);
    if (m) evs[STAT_KEYS[m[2]]] = Number(m[1]);
  }
  return Object.keys(evs).length ? evs : null;
}

function describeSet(set?: OpponentSet): string | null {
  if (!set) return null;
  const bits = [set.nature?.[0]?.name, set.evSpread?.[0]?.name, set.item[0]?.name].filter(Boolean);
  return bits.length ? `predicted ${bits.join(' · ')}` : null;
}

function safePokemon(species: string, opts: Record<string, unknown>): Pokemon | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- calc's option type is stricter than our dynamic set
    return new Pokemon(gen, species, opts as any);
  } catch {
    return null; // species/item/ability the calc data doesn't know (rare forms)
  }
}

function annotateMoves(moveNames: string[], attacker: Pokemon, defender: Pokemon): MoveAnnotation[] {
  const out: MoveAnnotation[] = [];
  for (const name of moveNames) {
    try {
      const result = calculate(gen, attacker, defender, new Move(gen, name));
      const [min, max] = result.range();
      const maxHP = defender.maxHP();
      if (!maxHP) continue;
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
