export const PLAYER_COLORS = [
  "red",
  "green",
  "yellow",
  "blue",
  "orange",
  "purple",
  "cyan",
  "pink",
  "teal",
  "lime",
] as const;

export type PlayerColor = (typeof PLAYER_COLORS)[number];
export type RoomStatus = "lobby" | "playing" | "finished";
export type TurnPhase = "roll" | "move" | "power";
export type GameMode = "classic" | "power" | "quick" | "race" | "blitz" | "team";
export type TeamSize = 2 | 3;
export type TeamAssignMode = "random" | "manual";

export interface Team {
  id: string;
  memberIds: string[];
}

/** Allowed Blitz match lengths (minutes). */
export const BLITZ_DURATION_OPTIONS = [
  { minutes: 15, label: "15 min" },
  { minutes: 20, label: "20 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 45, label: "45 min" },
  { minutes: 50, label: "50 min" },
  { minutes: 60, label: "1 hr" },
  { minutes: 75, label: "1.25 hr" },
  { minutes: 90, label: "1.5 hr" },
] as const;

export type BlitzDurationMinutes =
  (typeof BLITZ_DURATION_OPTIONS)[number]["minutes"];

export const DEFAULT_BLITZ_DURATION_MS = 45 * 60 * 1000;
/** Host can add this much time mid-match (unlimited times). */
export const BLITZ_EXTEND_MS = 5 * 60 * 1000;
/** @deprecated Prefer DEFAULT_BLITZ_DURATION_MS / room.blitzDurationMs */
export const BLITZ_DURATION_MS = DEFAULT_BLITZ_DURATION_MS;

const BLITZ_DURATION_MS_SET = new Set(
  BLITZ_DURATION_OPTIONS.map((option) => option.minutes * 60 * 1000),
);

export function normalizeBlitzDurationMs(ms?: number | null): number {
  if (typeof ms === "number" && BLITZ_DURATION_MS_SET.has(ms)) return ms;
  return DEFAULT_BLITZ_DURATION_MS;
}

export function blitzDurationLabel(ms?: number | null): string {
  const normalized = normalizeBlitzDurationMs(ms);
  const minutes = normalized / 60_000;
  return (
    BLITZ_DURATION_OPTIONS.find((option) => option.minutes === minutes)
      ?.label ?? `${minutes} min`
  );
}

/** Power, Quick, Race, Blitz, and Team place tiles on the track. */
export function hasPowerBoard(mode: GameMode | null | undefined): boolean {
  return (
    mode === "power" ||
    mode === "quick" ||
    mode === "race" ||
    mode === "blitz" ||
    mode === "team"
  );
}

/** Quick-style board: no TNT / −5, includes Super tiles. */
export function usesQuickPowerBoard(
  mode: GameMode | null | undefined,
): boolean {
  return mode === "quick" || mode === "race" || mode === "blitz";
}

/** Team: full Power set + Super leaps (TNT, −5, Super). */
export function usesTeamPowerBoard(
  mode: GameMode | null | undefined,
): boolean {
  return mode === "team";
}

/** Race mode: tokens share cells; captures are disabled. */
export function allowsCaptures(mode: GameMode | null | undefined): boolean {
  return mode !== "race";
}

/** Captures send tokens to start (0) instead of the yard. */
export function returnsCaptureToStart(
  mode: GameMode | null | undefined,
): boolean {
  return mode === "quick" || mode === "blitz";
}

/** 45-minute clock; winner is highest score when time expires. */
export function isBlitzMode(mode: GameMode | null | undefined): boolean {
  return mode === "blitz";
}

export function gameModeLabel(mode: GameMode | null | undefined): string {
  if (mode === "power") return "Power";
  if (mode === "quick") return "Quick";
  if (mode === "race") return "Race";
  if (mode === "blitz") return "Blitz";
  if (mode === "team") return "Team Power";
  return "Classic";
}
export type PowerUpType =
  | "plus10"
  | "half" // legacy; treated as plus10 if present in old rooms
  | "rocket"
  | "spring"
  | "shield"
  | "flame"
  | "x2"
  | "x3"
  | "star"
  | "ice"
  | "portal"
  | "super"
  | "back2"
  | "back3"
  | "back5"
  | "yard" // legacy; no longer generated
  | "tnt";

export interface PowerTile {
  cell: number;
  type: PowerUpType;
}

export interface Player {
  id: string;
  name: string;
  /** Named preset or #rrggbb hex. */
  color: string;
  seat: number;
  connected: boolean;
  isBot?: boolean;
  /** Host-enabled: server plays this human seat until cancelled. */
  autoPlay?: boolean;
  /**
   * Team mode: this bot seat is played by another human (not server autoplay).
   * Human rolls/moves for both their seat and this bot.
   */
  controlledBy?: string;
  /** Locked profile color — preserved across seat shuffle. */
  colorLocked?: boolean;
  /**
   * Secret seat code (host-only in client views). Anyone with it can reclaim
   * this seat mid-game at the same board position.
   */
  rejoinCode?: string;
  joinedAt: number;
}

/** Bots (unless human-controlled) and host-autoplay humans are driven by the server. */
export function isAutoControlled(player: Player | null | undefined): boolean {
  if (!player) return false;
  if (player.autoPlay) return true;
  if (player.isBot && !player.controlledBy) return true;
  return false;
}

/** True if `userId` may roll/move for this seat. */
export function canControlSeat(
  player: Player | null | undefined,
  userId: string,
): boolean {
  if (!player) return false;
  return player.id === userId || player.controlledBy === userId;
}

export interface DepartedPlayer extends Player {
  leftAt: number;
  /** Mid-game leave: can reclaim board state with rejoinCode. */
  reclaimable?: boolean;
  savedTokens?: Token[];
  savedStats?: PlayerStats;
  savedEntryMisses?: number;
  savedFinishMisses?: number;
  savedProtectionForfeited?: boolean;
  savedShieldBuff?: boolean;
  /** Index in winnerIds when they left, if they had finished. */
  savedWinnerPlace?: number;
}

export interface Token {
  id: number;
  playerId: string;
  progress: number;
}

export interface MovingToken {
  playerId: string;
  id: number;
  fromProgress: number;
  dice: number;
  startedAt?: number;
  targetProgress?: number;
  /** True when this hop will capture — used to time the eliminate SFX. */
  willCapture?: boolean;
  /** Player ids whose tokens were sent back by this capture. */
  captureVictimIds?: string[];
}

export interface ActiveMove {
  playerId: string;
  tokenId: number;
  fromProgress: number;
  dice: number;
  startedAt: number;
  targetProgress?: number;
  willCapture?: boolean;
}

export const TOKEN_MOVE_STEP_MS = 135;
export const TOKEN_MOVE_END_PADDING_MS = 240;

export const movingTokenTarget = (
  move: Pick<MovingToken, "fromProgress" | "dice" | "targetProgress">,
) =>
  move.targetProgress ??
  (move.fromProgress === -1 ? 0 : move.fromProgress + move.dice);

export const moveAnimStepCount = (move: MovingToken) => {
  const target = movingTokenTarget(move);
  let progress = move.fromProgress;
  let steps = 0;
  const forward = target >= (move.fromProgress === -1 ? 0 : move.fromProgress);
  if (forward) {
    while (progress < target && steps < 40) {
      steps += 1;
      progress = progress === -1 ? 0 : progress + 1;
    }
  } else {
    while (progress > target && steps < 40) {
      steps += 1;
      progress = progress <= 0 ? -1 : progress - 1;
    }
  }
  return Math.max(steps, 1);
};

export const tokenMoveDurationMs = (
  move: Pick<MovingToken, "fromProgress" | "dice" | "targetProgress">,
) =>
  moveAnimStepCount(move as MovingToken) * TOKEN_MOVE_STEP_MS +
  TOKEN_MOVE_END_PADDING_MS;

export const moveBaseSignature = (move: MovingToken) =>
  `${move.playerId}:${move.id}:${move.fromProgress}:${movingTokenTarget(move)}`;

export const resolveAnimationProgress = (movingToken: MovingToken) => {
  const target = movingTokenTarget(movingToken);
  if (!movingToken.startedAt) {
    return { progress: movingToken.fromProgress, done: false, target };
  }

  const stepsTaken = Math.floor(
    (Date.now() - movingToken.startedAt) / TOKEN_MOVE_STEP_MS,
  );
  if (stepsTaken <= 0) {
    return { progress: movingToken.fromProgress, done: false, target };
  }

  let progress = movingToken.fromProgress;
  const forward =
    target >= (movingToken.fromProgress === -1 ? 0 : movingToken.fromProgress);
  for (let step = 0; step < stepsTaken; step += 1) {
    if (forward) {
      if (progress >= target) {
        return { progress: target, done: true, target };
      }
      progress = progress === -1 ? 0 : progress + 1;
    } else {
      if (progress <= target) {
        return { progress: target, done: true, target };
      }
      progress = progress <= 0 ? -1 : progress - 1;
    }
  }

  return {
    progress,
    done: forward ? progress >= target : progress <= target,
    target,
  };
};

export interface PendingPower {
  playerId: string;
  tokenId: number;
  type: PowerUpType;
  landingCell: number;
  captured: boolean;
  sharedProtectedCell: boolean;
  forfeitedProtection: boolean;
}

export interface PlayerStats {
  captures: number;
  eliminated: number;
  tokensHome: number;
  sixes: number;
  /** attacker -> how many times this player eliminated that opponent */
  eliminatedPlayers: Record<string, number>;
}

export interface GameState {
  turnIndex: number;
  phase: TurnPhase;
  dice: number | null;
  /** Most recent roll — kept after turn pass so the UI can show unusable rolls. */
  lastDice?: number | null;
  consecutiveSixes: number;
  boardPlayerCount: number;
  turnDeadline: number | null;
  entryMisses: Record<string, number>;
  finishMisses: Record<string, number>;
  protectionForfeited: Record<string, boolean>;
  winnerIds: string[];
  tokens: Token[];
  lastAction: string;
  stats?: Record<string, PlayerStats>;
  activeMove?: ActiveMove | null;
  powerTiles?: Record<number, PowerUpType>;
  shieldBuff?: Record<string, boolean>;
  pendingExtraTurn?: string | null;
  pendingPower?: PendingPower | null;
  /** Blitz: wall-clock end time (ms since epoch). */
  endsAt?: number | null;
}

export interface Room {
  id: string;
  code: string;
  hostId: string;
  memberIds: string[];
  maxPlayers: number;
  gameMode: GameMode;
  /** Blitz only: selected match length in ms (from BLITZ_DURATION_OPTIONS). */
  blitzDurationMs?: number | null;
  /** Team mode: 2 or 3 players per team. */
  teamSize?: TeamSize | null;
  /** Team mode: random shuffle or host-picked teams. */
  teamAssign?: TeamAssignMode | null;
  /** Team mode: current team roster (lobby + in-match). */
  teams?: Team[] | null;
  /** Team mode: set when a full team finishes. */
  winningTeamId?: string | null;
  status: RoomStatus;
  players: Player[];
  departedPlayers: DepartedPlayer[];
  game: GameState | null;
  createdAt: number;
  updatedAt: number;
}
