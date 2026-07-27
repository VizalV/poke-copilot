/** Shared message contracts across injected.js ↔ content ↔ background ↔ backend. */

export interface PageMessage {
  source: 'poke-copilot';
  type: 'ready' | 'room-hooked' | 'protocol-chunk' | 'battle-request';
  payload: Record<string, unknown> & { roomid?: string };
}

/** Tag assigned to each benched Pokémon by the win-condition analyzer. */
export type WinConTag = 'MUST_PRESERVE' | 'FLEXIBLE' | 'SAFE_TO_SACRIFICE';

export interface PokemonAssessment {
  species: string;
  tag: WinConTag;
  /** Estimated win probability if this Pokémon faints this turn vs. preserved. */
  winProbIfLost: number;
  winProbIfPreserved: number;
  reason: string;
}

export interface PathwayStep {
  turn: number;
  action: string;
  rationale: string;
}

/** Bayesian opponent-model output (backend, PokéChamp predictor sidecar). */
export interface ComponentGuess {
  name: string;
  probability: number;
}

export interface OpponentSet {
  species: string;
  moves: ComponentGuess[];
  item: ComponentGuess[];
  ability: ComponentGuess[];
  nature: ComponentGuess[];
  evSpread: ComponentGuess[];
}

export interface OpponentIntel {
  unrevealed: ComponentGuess[];
  sets: OpponentSet[];
}

/** One streamed advice update for a battle room. */
export interface AdviceFrame {
  roomid: string;
  turn: number;
  overallWinProb: number;
  assessments: PokemonAssessment[];
  /** Highest-value line of play found by the (LLM-pruned) minimax search. */
  pathway: PathwayStep[];
  opponent: OpponentIntel;
  /** Backend latency in ms, displayed for trust/debugging. */
  latencyMs: number;
}

/** Client-side analysis computed entirely in the extension (no backend). */
export interface MoveAnnotation {
  move: string;
  minPct: number; // % of defender max HP
  maxPct: number;
  koChance: string; // e.g. "guaranteed 2HKO", "" if n/a
}

export interface LocalAnalysis {
  roomid: string;
  ourActive: string | null;
  oppActive: string | null;
  ourMoves: MoveAnnotation[]; // our active's moves vs. their active
  theirMoves: MoveAnnotation[]; // their revealed moves vs. our active
  /** e.g. "predicted Timid · 252 SpA / 252 Spe · Air Balloon", null before intel arrives. */
  oppSetLabel: string | null;
}
