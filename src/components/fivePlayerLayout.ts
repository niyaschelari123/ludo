/**
 * Pentagonal 5-player board geometry.
 * Each arm is a 3×6 grid with a triangular yard — track snakes along the sides,
 * not around a full circle.
 */
import type { Token } from "../game/types";
import {
  CELLS_PER_PLAYER,
  finishedProgress,
  globalCell,
  homeEntryProgress,
} from "../game/engine";
import type { Room } from "../game/types";

export const FIVE_PLAYER_COUNT = 5;
export const FIVE_BOARD_SIZE = 600;
export const FIVE_CENTER = FIVE_BOARD_SIZE / 2;
/** Tight crop around the pentagon — removes empty SVG margins on mobile. */
export const FIVE_VIEW_BOX = "6 6 588 588";

export const FIVE_CELL_SIZE = 28;
const CELL = FIVE_CELL_SIZE;
const ARM_INNER = 50;
const ARM_OUTER = 192;
const POCKET_TIP_RADIUS = 276;
const POCKET_CENTER_RADIUS = 236;
const OUTER_RING_RADIUS = 286;
const ROW_STEP = (ARM_OUTER - ARM_INNER) / 5;

export interface Point {
  x: number;
  y: number;
}

/** Outward angle for each seat — seat 0 points down (6 o'clock). */
export function fivePlayerArmAngle(seat: number) {
  return Math.PI / 2 + seat * ((Math.PI * 2) / FIVE_PLAYER_COUNT);
}

function armVectors(seat: number) {
  const angle = fivePlayerArmAngle(seat);
  return {
    dir: { x: Math.cos(angle), y: Math.sin(angle) },
    perp: { x: -Math.sin(angle), y: Math.cos(angle) },
  };
}

function polar(angle: number, radius: number): Point {
  return {
    x: FIVE_CENTER + Math.cos(angle) * radius,
    y: FIVE_CENTER + Math.sin(angle) * radius,
  };
}

/** Angle of the outer pocket between arm `seat` and the next arm clockwise. */
export function fivePlayerPocketAngle(seat: number) {
  return fivePlayerArmAngle(seat) + Math.PI / FIVE_PLAYER_COUNT;
}

export function fivePlayerYardCenter(seat: number): Point {
  return polar(fivePlayerPocketAngle(seat), POCKET_CENTER_RADIUS);
}

function toWorld(seat: number, along: number, across: number): Point {
  const { dir, perp } = armVectors(seat);
  return {
    x: FIVE_CENTER + dir.x * along + perp.x * across,
    y: FIVE_CENTER + dir.y * along + perp.y * across,
  };
}

/** Local arm grid: col -1 left track, 0 home lane, 1 right track; row 0 outer → 5 inner. */
export function fivePlayerGridPoint(
  seat: number,
  col: -1 | 0 | 1,
  row: number,
): Point {
  const along = ARM_OUTER - row * ROW_STEP;
  return toWorld(seat, along, col * CELL);
}

type TrackSlot =
  | { kind: "track"; seat: number; col: -1 | 1; row: number }
  | { kind: "entry"; seat: number }
  | { kind: "junction"; seat: number };

/** Right-column rows for base+0 (entry) through base+5 — entry sits one step inward, before the star. */
const RIGHT_COLUMN_ROWS = [1, 0, 2, 3, 4, 5];

/** Map global track cell index (0–64) to arm grid slots. */
function buildTrackSlots(): TrackSlot[] {
  const slots: TrackSlot[] = [];
  for (let seat = 0; seat < FIVE_PLAYER_COUNT; seat += 1) {
    const base = seat * CELLS_PER_PLAYER;
    slots[base] = { kind: "entry", seat };
    for (let step = 1; step <= 5; step += 1) {
      slots[base + step] = {
        kind: "track",
        seat,
        col: 1,
        row: RIGHT_COLUMN_ROWS[step],
      };
    }
    slots[base + 6] = { kind: "junction", seat };
    for (let step = 0; step < 6; step += 1) {
      slots[base + 7 + step] = {
        kind: "track",
        seat,
        col: -1,
        row: 5 - step,
      };
    }
  }
  return slots;
}

const TRACK_SLOTS = buildTrackSlots();

export function fivePlayerTrackPoint(cell: number): Point {
  const slot = TRACK_SLOTS[cell];
  if (!slot) return { x: FIVE_CENTER, y: FIVE_CENTER };

  if (slot.kind === "entry") {
    return fivePlayerGridPoint(slot.seat, 1, RIGHT_COLUMN_ROWS[0]);
  }
  if (slot.kind === "junction") {
    return fivePlayerGridPoint(slot.seat, -1, 5);
  }
  return fivePlayerGridPoint(slot.seat, slot.col, slot.row);
}

export function fivePlayerHomePoint(seat: number, laneIndex: number): Point {
  const row = Math.max(0, 5 - laneIndex);
  return fivePlayerGridPoint(seat, 0, row);
}

export function fivePlayerFinishPoint(seat: number, tokenId: number): Point {
  const angle = fivePlayerArmAngle(seat);
  const offsets = [
    { r: 0, t: 0 },
    { r: 10, t: -0.35 },
    { r: 10, t: 0.35 },
    { r: 18, t: 0 },
  ];
  const { r, t } = offsets[tokenId] ?? offsets[0];
  return {
    x: FIVE_CENTER + Math.cos(angle + t) * r,
    y: FIVE_CENTER + Math.sin(angle + t) * r,
  };
}

export function fivePlayerCellRotation(seat: number) {
  return (fivePlayerArmAngle(seat) * 180) / Math.PI + 90;
}

export function fivePlayerTrackSeat(cell: number): number {
  const slot = TRACK_SLOTS[cell];
  return slot?.seat ?? 0;
}

/** Stable key for deduplicating cells that share the same grid slot. */
export function fivePlayerCellKey(cell: number): string {
  const slot = TRACK_SLOTS[cell];
  if (!slot) return `missing:${cell}`;
  if (slot.kind === "entry") return `${slot.seat}:1:${RIGHT_COLUMN_ROWS[0]}`;
  if (slot.kind === "junction") return `${slot.seat}:-1:5`;
  return `${slot.seat}:${slot.col}:${slot.row}`;
}

const YARD_TOKEN_OFFSETS = [
  { t: -16, r: -12 },
  { t: 16, r: -12 },
  { t: -16, r: 12 },
  { t: 16, r: 12 },
];

export function fivePlayerYardPoint(seat: number, tokenId: number): Point {
  const center = fivePlayerYardCenter(seat);
  const angle = fivePlayerPocketAngle(seat);
  const tangent = angle + Math.PI / 2;
  const { t, r } = YARD_TOKEN_OFFSETS[tokenId] ?? YARD_TOKEN_OFFSETS[0];
  return {
    x: center.x + Math.cos(tangent) * t + Math.cos(angle) * r,
    y: center.y + Math.sin(tangent) * t + Math.sin(angle) * r,
  };
}

export function fivePlayerTokenPoint(token: Token, room: Room): Point {
  const player = room.players.find(
    (candidate) => candidate.id === token.playerId,
  )!;
  const homeEntry = homeEntryProgress(room.players);

  if (token.progress === -1) {
    return fivePlayerYardPoint(player.seat, token.id);
  }
  if (token.progress >= finishedProgress(room.players)) {
    return fivePlayerFinishPoint(player.seat, token.id);
  }
  if (token.progress >= homeEntry) {
    return fivePlayerHomePoint(player.seat, token.progress - homeEntry);
  }
  const cell = globalCell(token, room.players);
  if (cell === null) return fivePlayerYardPoint(player.seat, token.id);
  return fivePlayerTrackPoint(cell);
}

/** Outer pentagon vertices between arms. */
export function fivePlayerOuterRing(): Point[] {
  return Array.from({ length: FIVE_PLAYER_COUNT }, (_, seat) =>
    polar(fivePlayerPocketAngle(seat), OUTER_RING_RADIUS),
  );
}

/** Inner hub pentagon vertices. */
export function fivePlayerHubRing(): Point[] {
  return Array.from({ length: FIVE_PLAYER_COUNT }, (_, seat) => {
    const angle = fivePlayerArmAngle(seat) + Math.PI / FIVE_PLAYER_COUNT;
    return {
      x: FIVE_CENTER + Math.cos(angle) * 42,
      y: FIVE_CENTER + Math.sin(angle) * 42,
    };
  });
}

export function fivePlayerYardTriangle(seat: number): Point[] {
  const next = (seat + 1) % FIVE_PLAYER_COUNT;
  const tip = polar(fivePlayerPocketAngle(seat), POCKET_TIP_RADIUS);
  const leftBase = fivePlayerGridPoint(seat, -1, 0);
  const rightBase = fivePlayerGridPoint(next, 1, 0);
  return [tip, leftBase, rightBase];
}

export function fivePlayerArmPanel(seat: number): Point[] {
  const outerLeft = fivePlayerGridPoint(seat, -1, 0);
  const outerRight = fivePlayerGridPoint(seat, 1, 0);
  const innerLeft = fivePlayerGridPoint(seat, -1, 5);
  const innerRight = fivePlayerGridPoint(seat, 1, 5);
  const hub = fivePlayerHubRing();
  const hubLeft = hub[(seat + FIVE_PLAYER_COUNT - 1) % FIVE_PLAYER_COUNT];
  const hubRight = hub[seat];
  return [outerLeft, outerRight, innerRight, hubRight, hubLeft, innerLeft];
}

const FIVE_SAFE_TRACK_OFFSET = 2;

export function fivePlayerSafeCells(players: { seat: number }[]) {
  const total = FIVE_PLAYER_COUNT * CELLS_PER_PLAYER;
  return new Set(
    players.flatMap((player) => {
      const start = player.seat * CELLS_PER_PLAYER;
      return [
        (start + FIVE_SAFE_TRACK_OFFSET) % total,
        (start + 8 + FIVE_SAFE_TRACK_OFFSET) % total,
      ];
    }),
  );
}

export function isFivePlayerBoard(room: Room) {
  return boardSeatCount(room) === FIVE_PLAYER_COUNT;
}

function boardSeatCount(room: Room) {
  const seats = [
    ...room.players,
    ...(room.game ? (room.departedPlayers ?? []) : []),
  ].map((player) => player.seat);
  return seats.length === 0 ? room.players.length : Math.max(...seats) + 1;
}
