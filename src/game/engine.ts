import type {
  ActiveMove,
  GameMode,
  GameState,
  MovingToken,
  Player,
  PlayerStats,
  Room,
  Token,
} from "./types";
import {
  applyPowerUp,
  generatePowerTiles,
  generateQuickPowerTiles,
  generateTeamPowerTiles,
  powerUpAtCell,
} from "./powerUps";
import { areTeammates, isTeamMode } from "./teams";
import {
  allowsCaptures,
  canControlSeat,
  hasPowerBoard,
  isBlitzMode,
  returnsCaptureToStart,
  usesQuickPowerBoard,
  usesTeamPowerBoard,
  normalizeBlitzDurationMs,
} from "./types";

// A classic four-player board has 52 outer cells: 13 per player.
// The same sector length extends cleanly to the 5–8 player polygon boards.
export const CELLS_PER_PLAYER = 13;
// Inner home-lane cells before the center finish position.
export const HOME_LENGTH = 5;
export const TOKENS_PER_PLAYER = 4;
export const QUICK_TOKENS_PER_PLAYER = 3;
export const TEAM_TOKENS_PER_PLAYER = 2;
export const TURN_ROLL_TIMEOUT_MS = 20_000;
export const TURN_MOVE_TIMEOUT_MS = 20_000;

export function tokensPerPlayer(gameMode: GameMode | null | undefined) {
  if (gameMode === "quick") return QUICK_TOKENS_PER_PLAYER;
  if (gameMode === "team") return TEAM_TOKENS_PER_PLAYER;
  return TOKENS_PER_PLAYER;
}

/** Captured tokens go to the yard (−1), except Quick/Blitz (back to start at 0). */
export function eliminatedProgress(room: Room) {
  return returnsCaptureToStart(room.gameMode) ? 0 : -1;
}

/** Five-player pentagon boards use one extra home cell before the center. */
export const homeLengthForBoard = (boardPlayerCount: number) =>
  boardPlayerCount === 5 ? 6 : HOME_LENGTH;

export function allSeatPlayers(room: Room): Player[] {
  return [...room.players, ...(room.departedPlayers ?? [])].sort(
    (first, second) => first.seat - second.seat,
  );
}

export function getBoardPlayerCount(room: Room): number {
  if (room.game?.boardPlayerCount) return room.game.boardPlayerCount;
  const seats = allSeatPlayers(room);
  return seats.length > 0
    ? Math.max(...seats.map((player) => player.seat)) + 1
    : room.players.length;
}

export const trackLength = (room: Room) =>
  getBoardPlayerCount(room) * CELLS_PER_PLAYER;

/**
 * First progress value on the inward home lane.
 * Outer track is 0 … trackLength-1 (last cell is the normal square before your
 * colored start). Tokens never re-enter that start square on the way home.
 */
export const homeEntryProgress = (room: Room) => trackLength(room);

export const finishedProgress = (room: Room) =>
  homeEntryProgress(room) + homeLengthForBoard(getBoardPlayerCount(room));

export const safeCells = (room: Room) => {
  const length = trackLength(room);
  return new Set(
    allSeatPlayers(room).flatMap((player) => {
      const start = player.seat * CELLS_PER_PLAYER;
      return [start, (start + 8) % length];
    }),
  );
};

function beginRollPhase(game: GameState) {
  game.phase = "roll";
  game.dice = null;
  game.turnDeadline = Date.now() + TURN_ROLL_TIMEOUT_MS;
}

function emptyPlayerStats(): PlayerStats {
  return {
    captures: 0,
    eliminated: 0,
    tokensHome: 0,
    sixes: 0,
    eliminatedPlayers: {},
  };
}

export function ensurePlayerStats(
  game: GameState,
  playerId: string,
): PlayerStats {
  game.stats ??= {};
  if (!game.stats[playerId]) {
    game.stats[playerId] = emptyPlayerStats();
  } else {
    game.stats[playerId].eliminatedPlayers ??= {};
  }
  return game.stats[playerId];
}

export function recordCapture(
  game: GameState,
  attackerId: string,
  victimId: string,
) {
  const attacker = ensurePlayerStats(game, attackerId);
  attacker.captures += 1;
  attacker.eliminatedPlayers[victimId] =
    (attacker.eliminatedPlayers[victimId] ?? 0) + 1;
  ensurePlayerStats(game, victimId).eliminated += 1;
}

export function recordEliminated(game: GameState, playerId: string) {
  ensurePlayerStats(game, playerId).eliminated += 1;
}

export function createGame(
  players: Player[],
  gameMode: GameMode = "classic",
  options?: { blitzDurationMs?: number | null },
): GameState {
  const boardPlayerCount = players.length;
  const blitzMs = normalizeBlitzDurationMs(options?.blitzDurationMs);
  return {
    turnIndex: 0,
    phase: "roll",
    dice: null,
    lastDice: null,
    consecutiveSixes: 0,
    boardPlayerCount,
    turnDeadline: Date.now() + TURN_ROLL_TIMEOUT_MS,
    entryMisses: Object.fromEntries(players.map((player) => [player.id, 0])),
    finishMisses: Object.fromEntries(players.map((player) => [player.id, 0])),
    protectionForfeited: Object.fromEntries(
      players.map((player) => [player.id, false]),
    ),
    winnerIds: [],
    tokens: players.flatMap((player) =>
      Array.from({ length: tokensPerPlayer(gameMode) }, (_, id) => ({
        id,
        playerId: player.id,
        // Start with one token already on the start square so games open faster.
        progress: id === 0 ? 0 : -1,
      })),
    ),
    lastAction: `${players[0].name} starts`,
    stats: Object.fromEntries(
      players.map((player) => [player.id, emptyPlayerStats()]),
    ),
    activeMove: null,
    powerTiles: usesTeamPowerBoard(gameMode)
      ? generateTeamPowerTiles(boardPlayerCount)
      : usesQuickPowerBoard(gameMode)
        ? generateQuickPowerTiles(boardPlayerCount)
        : gameMode === "power"
          ? generatePowerTiles(boardPlayerCount)
          : {},
    shieldBuff: {},
    pendingExtraTurn: null,
    pendingPower: null,
    endsAt: gameMode === "blitz" ? Date.now() + blitzMs : null,
  };
}

export function globalCell(token: Token, room: Room) {
  const length = trackLength(room);
  if (token.progress < 0 || token.progress >= homeEntryProgress(room)) {
    return null;
  }
  const player = allSeatPlayers(room).find(
    (candidate) => candidate.id === token.playerId,
  );
  if (!player) return null;
  return (player.seat * CELLS_PER_PLAYER + token.progress) % length;
}

export function canMove(token: Token, dice: number, room: Room) {
  const finish = finishedProgress(room);
  if (token.progress >= finish) return false;
  if (token.progress === -1) return dice === 6;
  return token.progress + dice <= finish;
}

export function isSoleTokenProtected(
  game: GameState,
  playerId: string,
  room: Room,
) {
  const finish = finishedProgress(room);
  const playerTokens = game.tokens.filter(
    (token) => token.playerId === playerId,
  );
  const hasFinishedToken = playerTokens.some(
    (token) => token.progress >= finish,
  );
  const activeTokens = playerTokens.filter(
    (token) => token.progress >= 0 && token.progress < finish,
  );
  return (
    !hasFinishedToken &&
    activeTokens.length === 1 &&
    !game.protectionForfeited?.[playerId]
  );
}

export function resolveLandingCapture(
  room: Room,
  playerId: string,
  token: Token,
): { captured: boolean; sharedProtectedCell: boolean } {
  const game = room.game;
  if (!game) return { captured: false, sharedProtectedCell: false };
  if (!allowsCaptures(room.gameMode)) {
    return { captured: false, sharedProtectedCell: false };
  }

  game.shieldBuff ??= {};
  let captured = false;
  let sharedProtectedCell = false;
  const landingCell = globalCell(token, room);

  if (landingCell === null || safeCells(room).has(landingCell)) {
    return { captured, sharedProtectedCell };
  }

  for (const opponent of game.tokens) {
    if (
      opponent.playerId !== playerId &&
      !areTeammates(room, playerId, opponent.playerId) &&
      globalCell(opponent, room) === landingCell
    ) {
      if (isSoleTokenProtected(game, opponent.playerId, room)) {
        sharedProtectedCell = true;
      } else if (game.shieldBuff[opponent.playerId]) {
        game.shieldBuff[opponent.playerId] = false;
        sharedProtectedCell = true;
      } else {
        opponent.progress = eliminatedProgress(room);
        recordCapture(game, playerId, opponent.playerId);
        captured = true;
      }
    }
  }

  return { captured, sharedProtectedCell };
}

export function hasActiveToken(game: GameState, playerId: string, room: Room) {
  const finish = finishedProgress(room);
  return game.tokens.some(
    (token) =>
      token.playerId === playerId &&
      token.progress >= 0 &&
      token.progress < finish,
  );
}

export function requiredFinalRoll(
  game: GameState,
  playerId: string,
  room: Room,
) {
  const finish = finishedProgress(room);
  const unfinishedTokens = game.tokens.filter(
    (token) => token.playerId === playerId && token.progress < finish,
  );
  if (unfinishedTokens.length !== 1) return null;
  const remaining = finish - unfinishedTokens[0].progress;
  return remaining >= 1 && remaining <= 3 ? remaining : null;
}

function randomDiceValue() {
  return (crypto.getRandomValues(new Uint8Array(1))[0] % 6) + 1;
}

export function resolveDiceValue(
  game: GameState,
  playerId: string,
  room: Room,
) {
  game.entryMisses ??= {};
  game.finishMisses ??= {};
  const entryMisses = game.entryMisses[playerId] ?? 0;
  const finishMisses = game.finishMisses[playerId] ?? 0;
  const hasActive = hasActiveToken(game, playerId, room);
  const finalRoll = requiredFinalRoll(game, playerId, room);
  const randomDice = randomDiceValue();
  return !hasActive && entryMisses >= 4
    ? 6
    : finalRoll !== null && finishMisses >= 7
      ? finalRoll
      : randomDice;
}

export function applyRollMisses(
  game: GameState,
  playerId: string,
  room: Room,
  dice: number,
) {
  game.entryMisses ??= {};
  game.finishMisses ??= {};
  const entryMisses = game.entryMisses[playerId] ?? 0;
  const finishMisses = game.finishMisses[playerId] ?? 0;
  const hasActive = hasActiveToken(game, playerId, room);
  const finalRoll = requiredFinalRoll(game, playerId, room);
  game.entryMisses[playerId] = hasActive || dice === 6 ? 0 : entryMisses + 1;
  game.finishMisses[playerId] =
    finalRoll === null || dice === finalRoll ? 0 : finishMisses + 1;
}

export function performLocalMove(room: Room, userId: string, tokenId: number) {
  const next = structuredClone(room);
  const game = next.game;
  if (!game || game.phase !== "move") {
    throw new Error("A token cannot be moved now.");
  }
  if (!canControlSeat(next.players[game.turnIndex], userId)) {
    throw new Error("It is not your turn.");
  }
  applyMove(next, tokenId);
  next.updatedAt = Date.now();
  return next;
}

export function movableTokens(room: Room) {
  if (!room.game?.dice) return [];
  const player = room.players[room.game.turnIndex];
  return room.game.tokens.filter(
    (token) =>
      token.playerId === player?.id && canMove(token, room.game!.dice!, room),
  );
}

/** Prefer captures, home finishes, then yard exits for auto/bot moves. */
export function pickBestMovableToken(room: Room): Token | null {
  const game = room.game;
  if (!game?.dice) return null;

  const candidates = movableTokens(room);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const finish = finishedProgress(room);
  const dice = game.dice;

  const scoreToken = (token: Token) => {
    const targetProgress = token.progress === -1 ? 0 : token.progress + dice;
    let score = targetProgress;

    if (token.progress === -1) score += 120;
    if (targetProgress === finish) score += 250;

    const landingToken = { ...token, progress: targetProgress };
    const landingCell = globalCell(landingToken, room);
    if (landingCell !== null && !safeCells(room).has(landingCell)) {
      for (const opponent of game.tokens) {
        if (opponent.playerId === token.playerId) continue;
        if (globalCell(opponent, room) !== landingCell) continue;
        if (isSoleTokenProtected(game, opponent.playerId, room)) continue;
        if (game.shieldBuff?.[opponent.playerId]) continue;
        score += 500;
      }
    }

    return score;
  };

  return candidates.reduce((best: Token, token: Token) =>
    scoreToken(token) > scoreToken(best) ? token : best,
  );
}

function playerHasAllTokensHome(room: Room, game: GameState, playerId: string) {
  const finish = finishedProgress(room);
  const tokens = game.tokens.filter((token) => token.playerId === playerId);
  return tokens.length > 0 && tokens.every((token) => token.progress >= finish);
}

function nextActiveTurn(room: Room, game: GameState) {
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const index = (game.turnIndex + offset) % room.players.length;
    const playerId = room.players[index].id;
    if (game.winnerIds.includes(playerId)) continue;
    if (
      isBlitzMode(room.gameMode) &&
      playerHasAllTokensHome(room, game, playerId)
    ) {
      continue;
    }
    return index;
  }
  return game.turnIndex;
}

function passTurn(room: Room, game: GameState) {
  game.turnIndex = nextActiveTurn(room, game);
  game.consecutiveSixes = 0;
  beginRollPhase(game);
}

export function applyRoll(room: Room, value: number) {
  const game = room.game;
  if (!game || game.phase !== "roll")
    throw new Error("Dice cannot be rolled now.");
  const player = room.players[game.turnIndex];
  if (!player) throw new Error("Current player is missing.");

  game.dice = value;
  game.lastDice = value;
  game.consecutiveSixes = value === 6 ? game.consecutiveSixes + 1 : 0;
  game.lastAction = `${player.name} rolled ${value}`;
  if (value === 6) {
    ensurePlayerStats(game, player.id).sixes += 1;
  }

  if (game.consecutiveSixes === 3) {
    game.lastAction = `${player.name} rolled three sixes and lost the turn`;
    passTurn(room, game);
    return;
  }

  game.phase = "move";
  if (movableTokens(room).length === 0) {
    game.lastAction = `${player.name} rolled ${value} — no moves`;
    game.turnDeadline = null;
    passTurn(room, game);
    return;
  }
  game.turnDeadline = Date.now() + TURN_MOVE_TIMEOUT_MS;
}

function formatMoveAction(
  player: Player,
  {
    captured,
    reachedHome,
    sharedProtectedCell,
    forfeitedProtection,
  }: {
    captured: boolean;
    reachedHome: boolean;
    sharedProtectedCell: boolean;
    forfeitedProtection: boolean;
  },
) {
  if (captured) return `${player.name} captured a token`;
  if (reachedHome) return `${player.name} brought a token home`;
  if (sharedProtectedCell) return `${player.name} shared a protected cell`;
  if (forfeitedProtection) {
    return `${player.name} moved and forfeited token protection`;
  }
  return `${player.name} moved a token`;
}

function completeTurnAfterMove(
  room: Room,
  game: GameState,
  player: Player,
  dice: number,
  {
    captured,
    reachedHome,
    allHome,
  }: {
    captured: boolean;
    reachedHome: boolean;
    allHome: boolean;
  },
  preserveActiveMove = false,
) {
  if (tryConcludeByFinishPlaces(room, game)) return;

  const earnsExtraTurn =
    dice === 6 ||
    captured ||
    reachedHome ||
    game.pendingExtraTurn === player.id;
  if (game.pendingExtraTurn === player.id) {
    game.pendingExtraTurn = null;
  }
  if (!preserveActiveMove) {
    game.activeMove = null;
  }
  if (!earnsExtraTurn || allHome) {
    passTurn(room, game);
  } else {
    beginRollPhase(game);
  }
}

/** Classic/Power/Quick/Race: filling places can end the match. Blitz waits for the clock. */
function tryConcludeByFinishPlaces(room: Room, game: GameState) {
  if (isBlitzMode(room.gameMode)) return false;

  if (isTeamMode(room.gameMode) && room.teams?.length) {
    const teamSize = room.teamSize ?? 2;
    const finishedTeam = room.teams.find(
      (team) =>
        team.memberIds.length >= teamSize &&
        team.memberIds.every((id) => game.winnerIds.includes(id)),
    );
    if (!finishedTeam) return false;
    room.winningTeamId = finishedTeam.id;
    room.status = "finished";
    game.lastAction = `Team wins! ${finishedTeam.memberIds
      .map(
        (id) =>
          room.players.find((player) => player.id === id)?.name ??
          (room.departedPlayers ?? []).find((player) => player.id === id)
            ?.name ??
          "Player",
      )
      .join(" & ")} finished`;
    return true;
  }

  if (game.winnerIds.length < room.players.length - 1) return false;
  const lastPlayer = room.players.find(
    (candidate) => !game.winnerIds.includes(candidate.id),
  );
  if (lastPlayer) game.winnerIds.push(lastPlayer.id);
  room.status = "finished";
  return true;
}

function notePlayerFinished(room: Room, game: GameState, player: Player) {
  if (isBlitzMode(room.gameMode)) {
    game.lastAction = `${player.name} got all tokens home!`;
    return;
  }
  if (game.winnerIds.includes(player.id)) return;
  game.winnerIds.push(player.id);
  if (isTeamMode(room.gameMode)) {
    const team = room.teams?.find((entry) =>
      entry.memberIds.includes(player.id),
    );
    const done = team
      ? team.memberIds.filter((id) => game.winnerIds.includes(id)).length
      : 1;
    const need = room.teamSize ?? team?.memberIds.length ?? 2;
    game.lastAction = `${player.name} finished (${done}/${need} teammates home)`;
  } else {
    game.lastAction = `${player.name} finished in place #${game.winnerIds.length}`;
  }
}

export function applyPendingPower(room: Room, startedAt = Date.now()) {
  const game = room.game;
  if (!game || game.phase !== "power" || !game.pendingPower) {
    throw new Error("No power to resolve.");
  }

  const pending = game.pendingPower;
  const player = room.players.find(
    (candidate) => candidate.id === pending.playerId,
  );
  if (!player) throw new Error("Current player is missing.");

  const token = game.tokens.find(
    (candidate) =>
      candidate.playerId === pending.playerId &&
      candidate.id === pending.tokenId,
  );
  if (!token) throw new Error("That move is not valid.");

  const dice = game.dice ?? 1;
  const finish = finishedProgress(room);
  const progressBeforePower = token.progress;
  const powerMessage = applyPowerUp(
    room,
    player,
    token,
    pending.type,
    pending.landingCell,
  );

  game.pendingPower = null;

  let captured = pending.captured;
  let sharedProtectedCell = pending.sharedProtectedCell ?? false;
  if (token.progress !== progressBeforePower) {
    const powerLandingCapture = resolveLandingCapture(room, player.id, token);
    captured = captured || powerLandingCapture.captured;
    sharedProtectedCell =
      sharedProtectedCell || powerLandingCapture.sharedProtectedCell;
  }

  const reachedHomeAfterPower = token.progress === finish;
  if (reachedHomeAfterPower && token.progress !== progressBeforePower) {
    ensurePlayerStats(game, player.id).tokensHome += 1;
  }
  const allHome = game.tokens
    .filter((candidate) => candidate.playerId === player.id)
    .every((candidate) => candidate.progress >= finish);

  if (allHome) {
    notePlayerFinished(room, game, player);
  } else if (captured) {
    game.lastAction = `${player.name} captured a token`;
  } else {
    game.lastAction = powerMessage;
  }

  if (token.progress !== progressBeforePower) {
    game.activeMove = {
      playerId: player.id,
      tokenId: token.id,
      fromProgress: progressBeforePower,
      dice: token.progress - progressBeforePower,
      startedAt,
      targetProgress: token.progress,
      willCapture: captured,
    };
  } else {
    game.activeMove = null;
  }

  if (tryConcludeByFinishPlaces(room, game)) return;

  completeTurnAfterMove(
    room,
    game,
    player,
    dice,
    {
      captured,
      reachedHome: reachedHomeAfterPower,
      allHome,
    },
    token.progress !== progressBeforePower,
  );
}

export function performLocalResolvePower(room: Room, userId: string) {
  const next = structuredClone(room);
  const game = next.game;
  if (!game || game.phase !== "power") {
    throw new Error("No power to resolve.");
  }
  if (!canControlSeat(next.players[game.turnIndex], userId)) {
    throw new Error("It is not your turn.");
  }
  applyPendingPower(next);
  next.updatedAt = Date.now();
  return next;
}

export function applyMove(room: Room, tokenId: number) {
  const game = room.game;
  const dice = game?.dice;
  if (!game || game.phase !== "move" || !dice) {
    throw new Error("A token cannot be moved now.");
  }

  const player = room.players[game.turnIndex];
  const token = game.tokens.find(
    (candidate) => candidate.playerId === player.id && candidate.id === tokenId,
  );
  if (!token || !canMove(token, dice, room)) {
    throw new Error("That move is not valid.");
  }

  game.protectionForfeited ??= {};
  const playerTokensBeforeMove = game.tokens.filter(
    (candidate) => candidate.playerId === player.id,
  );
  const finish = finishedProgress(room);
  const activeTokensBeforeMove = playerTokensBeforeMove.filter(
    (candidate) => candidate.progress >= 0 && candidate.progress < finish,
  );
  const hasTokenInYard = playerTokensBeforeMove.some(
    (candidate) => candidate.progress === -1,
  );
  const enteringFromYard = token.progress === -1;
  const forfeitedProtection =
    dice === 6 &&
    hasTokenInYard &&
    activeTokensBeforeMove.length === 1 &&
    !enteringFromYard;
  if (enteringFromYard) {
    game.protectionForfeited[player.id] = false;
  } else if (forfeitedProtection) {
    game.protectionForfeited[player.id] = true;
  }

  token.progress = token.progress === -1 ? 0 : token.progress + dice;
  const { captured, sharedProtectedCell } = resolveLandingCapture(
    room,
    player.id,
    token,
  );

  const reachedHome = token.progress === finish;
  if (reachedHome) {
    ensurePlayerStats(game, player.id).tokensHome += 1;
  }
  const allHome = game.tokens
    .filter((candidate) => candidate.playerId === player.id)
    .every((candidate) => candidate.progress >= finish);

  const moveContext = {
    captured,
    reachedHome,
    sharedProtectedCell,
    forfeitedProtection,
  };

  const landingCell = globalCell(token, room);

  if (
    hasPowerBoard(room.gameMode) &&
    landingCell !== null &&
    token.progress > 0 &&
    token.progress < homeEntryProgress(room)
  ) {
    const powerType = powerUpAtCell(game, landingCell);
    if (powerType) {
      game.pendingPower = {
        playerId: player.id,
        tokenId: token.id,
        type: powerType,
        landingCell,
        captured,
        sharedProtectedCell,
        forfeitedProtection,
      };
      game.phase = "power";
      game.activeMove = null;
      game.turnDeadline = null;
      game.lastAction = formatMoveAction(player, moveContext);
      return;
    }
  }

  if (allHome) {
    notePlayerFinished(room, game, player);
  } else {
    game.lastAction = formatMoveAction(player, moveContext);
  }

  if (tryConcludeByFinishPlaces(room, game)) return;

  completeTurnAfterMove(room, game, player, dice, {
    captured,
    reachedHome,
    allHome,
  });
}

/** Players whose tokens were reset to the eliminated slot between two room states. */
export function findCaptureVictimIds(prev: Room, next: Room): string[] {
  if (!prev.game || !next.game) return [];
  const elim = eliminatedProgress(next);
  const victims = new Set<string>();
  for (const token of next.game.tokens) {
    const before = prev.game.tokens.find(
      (candidate) =>
        candidate.playerId === token.playerId && candidate.id === token.id,
    );
    if (!before) continue;
    if (
      before.progress !== token.progress &&
      token.progress === elim &&
      before.progress !== elim
    ) {
      victims.add(token.playerId);
    }
  }
  return [...victims];
}

export function detectMovedToken(prev: Room, next: Room): MovingToken | null {
  if (!prev.game || !next.game) return null;
  if (prev.game.lastAction === next.game.lastAction) return null;

  const action = next.game.lastAction;
  if (action.includes("rolled")) return null;

  const mover = [...next.players]
    .sort((first, second) => second.name.length - first.name.length)
    .find((player) => action.startsWith(player.name));
  if (!mover) return null;

  for (const token of next.game.tokens) {
    if (token.playerId !== mover.id) continue;
    const oldToken = prev.game.tokens.find(
      (candidate) =>
        candidate.playerId === mover.id && candidate.id === token.id,
    );
    if (!oldToken || oldToken.progress === token.progress) continue;
    if (
      token.progress > oldToken.progress ||
      (oldToken.progress === -1 && token.progress >= 0)
    ) {
      const dice =
        oldToken.progress === -1 ? 6 : token.progress - oldToken.progress;
      if (dice > 0) {
        const willCapture = action.includes("captured");
        return {
          playerId: mover.id,
          id: token.id,
          fromProgress: oldToken.progress,
          dice,
          targetProgress: token.progress,
          willCapture,
          captureVictimIds: willCapture
            ? findCaptureVictimIds(prev, next)
            : undefined,
        };
      }
    }
  }

  return null;
}

export function activeMoveToMovingToken(active: ActiveMove): MovingToken {
  return {
    playerId: active.playerId,
    id: active.tokenId,
    fromProgress: active.fromProgress,
    dice: active.dice,
    startedAt: active.startedAt,
    targetProgress: active.targetProgress,
    willCapture: active.willCapture,
  };
}
