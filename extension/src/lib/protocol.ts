/**
 * Battle-log parsing built on @pkmn/protocol.
 *
 * The backend does the heavy state modeling; the extension tracks just enough
 * parsed state to render overlays and drive the client-side damage/speed calcs:
 * active species per side, levels, HP fractions, revealed moves, and our own
 * |request| payload (which carries true stats/items/abilities for our team).
 */
import { Protocol } from '@pkmn/protocol';

export interface MonInfo {
  species: string;
  level: number;
  hpFraction: number;
  revealedMoves: string[];
}

export interface SideSnapshot {
  active: string | null;
  mons: Record<string, MonInfo>;
}

export interface RequestActiveMove {
  move: string;
  id: string;
  disabled?: boolean;
}

/** The parts of Showdown's |request| JSON we use. */
export interface BattleRequest {
  side: {
    id: 'p1' | 'p2';
    pokemon: Array<{
      ident: string;
      details: string;
      condition: string;
      active: boolean;
      stats: { atk: number; def: number; spa: number; spd: number; spe: number };
      moves: string[];
      item: string;
      ability: string;
    }>;
  };
  active?: Array<{ moves: RequestActiveMove[] }>;
}

export interface BattleSnapshot {
  roomid: string;
  turn: number;
  ended: boolean;
  playerSide: 'p1' | 'p2' | null;
  p1: SideSnapshot;
  p2: SideSnapshot;
  request: BattleRequest | null;
}

const snapshots = new Map<string, BattleSnapshot>();

export function getSnapshot(roomid: string): BattleSnapshot {
  let snap = snapshots.get(roomid);
  if (!snap) {
    snap = {
      roomid,
      turn: 0,
      ended: false,
      playerSide: null,
      p1: { active: null, mons: {} },
      p2: { active: null, mons: {} },
      request: null,
    };
    snapshots.set(roomid, snap);
  }
  return snap;
}

export function ingestRequest(roomid: string, requestJson: string): BattleSnapshot {
  const snap = getSnapshot(roomid);
  try {
    const req = JSON.parse(requestJson) as BattleRequest;
    if (req?.side?.id) {
      snap.request = req;
      snap.playerSide = req.side.id;
    }
  } catch {
    /* empty or malformed request lines are normal (e.g. wait requests) */
  }
  return snap;
}

/** Feed one protocol chunk (possibly multiple |-lines) into the local snapshot. */
export function ingestChunk(roomid: string, chunk: string): BattleSnapshot {
  const snap = getSnapshot(roomid);
  for (const { args } of Protocol.parse(chunk)) {
    switch (args[0]) {
      case 'turn':
        snap.turn = Number(args[1]);
        break;
      case 'win':
      case 'tie':
        snap.ended = true;
        break;
      case 'poke':
        touchMon(snap, args[1], args[2]);
        break;
      case 'switch':
      case 'drag': {
        const side = sideOf(args[1]);
        const mon = touchMon(snap, args[1], args[2]);
        snap[side].active = mon.species;
        mon.hpFraction = parseHP(args[3]);
        break;
      }
      case 'move': {
        const side = sideOf(args[1]);
        const species = speciesOf(snap, args[1]);
        const mon = species ? snap[side].mons[species] : undefined;
        if (mon && args[2] && !mon.revealedMoves.includes(args[2])) {
          mon.revealedMoves.push(args[2]);
        }
        break;
      }
      case '-damage':
      case '-heal': {
        const side = sideOf(args[1]);
        const species = speciesOf(snap, args[1]);
        if (species && snap[side].mons[species]) {
          snap[side].mons[species].hpFraction = parseHP(args[2]);
        }
        break;
      }
      case 'faint': {
        const side = sideOf(args[1]);
        const species = speciesOf(snap, args[1]);
        if (species && snap[side].mons[species]) snap[side].mons[species].hpFraction = 0;
        break;
      }
    }
  }
  return snap;
}

function sideOf(ident: string): 'p1' | 'p2' {
  return ident.startsWith('p1') ? 'p1' : 'p2';
}

/** Map a protocol ident ("p1a: Sparky", possibly a nickname) to a known species. */
function speciesOf(snap: BattleSnapshot, ident: string): string | null {
  const side = sideOf(ident);
  const name = ident.split(': ')[1] ?? ident;
  if (snap[side].mons[name]) return name;
  // Nickname: fall back to the active mon on that side.
  return snap[side].active;
}

/** Register/update a mon from a details string ("Garchomp, L84, F"). */
function touchMon(snap: BattleSnapshot, ident: string, details: string): MonInfo {
  const side = sideOf(ident);
  const parts = details.split(', ');
  const species = parts[0];
  const levelPart = parts.find((p) => /^L\d+$/.test(p));
  const level = levelPart ? Number(levelPart.slice(1)) : 100;
  let mon = snap[side].mons[species];
  if (!mon) {
    mon = { species, level, hpFraction: 1, revealedMoves: [] };
    snap[side].mons[species] = mon;
  }
  return mon;
}

/** "73/100" | "45/100 tox" | "0 fnt" → fraction in [0, 1]. */
function parseHP(hpStatus: string | undefined): number {
  if (!hpStatus) return 1;
  const hp = hpStatus.split(' ')[0];
  if (hp === '0' || hpStatus.includes('fnt')) return 0;
  const [cur, max] = hp.split('/').map(Number);
  return max ? cur / max : 1;
}
