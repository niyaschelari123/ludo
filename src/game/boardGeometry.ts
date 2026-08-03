/**
 * Programmatic N-player polygonal Ludo board geometry.
 *
 * For N = 5 this produces a Ludo-King-style regular pentagon board;
 * for N = 6 a matching hexagonal board. Both use large triangular home
 * bases at the vertices, a continuous track along the polygon edges
 * (not a circle), home lanes into a compact central N-gon divided into
 * N equal finish sectors.
 *
 * Cell indices match the rules engine: seat S starts at S * CELLS_PER_PLAYER,
 * which lands on vertex S of the track polygon.
 */
import { CELLS_PER_PLAYER, homeLengthForBoard } from './engine'

export const BOARD_SIZE = 600
export const BOARD_CENTER = BOARD_SIZE / 2

/** Larger canvas for N-gon boards so path cells can sit without overlap. */
export function boardCanvasSize(playerCount: number) {
  if (playerCount === 5) return 1200
  if (playerCount === 6) return 1280
  return BOARD_SIZE
}

export interface Point {
  x: number
  y: number
}

export interface TrackCellGeom {
  index: number
  point: Point
  /** Radians — edge tangent angle (for aligning cell rects along the perimeter). */
  tangent: number
  /** Radians — outward normal (for power markers / slight offsets). */
  normal: number
}

export interface PlayerSectorGeom {
  seat: number
  /** Angle from center to the outer vertex (player tip). */
  angle: number
  /** Colored outer home wedge (large corner triangle / polygon). */
  homePolygon: Point[]
  /** White yard nest inside the home wedge. */
  yardPolygon: Point[]
  /** Four token nest positions inside the yard. */
  yardSlots: Point[]
  /** Home-lane cell centers, outer → inner (toward finish). */
  homeLane: Point[]
  /** Triangular finish sector in the central pentagon. */
  finishSector: Point[]
  labelPoint: Point
  rankPoint: Point
  startCellIndex: number
}

export interface BoardGeometry {
  size: number
  center: Point
  playerCount: number
  cellsPerPlayer: number
  homeLength: number
  /** Outer board silhouette (regular N-gon). */
  outerPolygon: Point[]
  /** Inner edge of the colored homes / outer rim of the track field. */
  trackFieldPolygon: Point[]
  /** Compact central finish pentagon/hexagon. */
  finishPolygon: Point[]
  trackCells: TrackCellGeom[]
  sectors: PlayerSectorGeom[]
  cellSize: number
  yardTokenRadius: number
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

export function polar(
  radius: number,
  angle: number,
  center: Point = { x: BOARD_CENTER, y: BOARD_CENTER },
): Point {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  }
}

export function pointList(items: Point[]) {
  return items.map(({ x, y }) => `${x},${y}`).join(' ')
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  }
}

export function regularPolygonVertices(
  sides: number,
  radius: number,
  startAngle: number,
  center: Point = { x: BOARD_CENTER, y: BOARD_CENTER },
): Point[] {
  return Array.from({ length: sides }, (_, index) =>
    polar(radius, startAngle + (index * Math.PI * 2) / sides, center),
  )
}

/** Flat-top / vertex orientation: one vertex at the top for odd N (Ludo-King style). */
export function boardStartAngle(playerCount: number) {
  if (playerCount === 4) return (-Math.PI * 3) / 4
  return -Math.PI / 2
}

function edgeLength(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function polygonPerimeter(vertices: Point[]) {
  let total = 0
  for (let index = 0; index < vertices.length; index += 1) {
    total += edgeLength(vertices[index], vertices[(index + 1) % vertices.length])
  }
  return total
}

/**
 * Walk a fraction `t` ∈ [0, 1) of the polygon perimeter starting at vertex 0.
 * Returns the point plus the edge tangent and outward normal.
 */
export function pointOnPolygonPerimeter(
  vertices: Point[],
  t: number,
  center: Point = { x: BOARD_CENTER, y: BOARD_CENTER },
): { point: Point; tangent: number; normal: number; edgeIndex: number } {
  const sides = vertices.length
  if (sides === 0) {
    return { point: { ...center }, tangent: 0, normal: 0, edgeIndex: 0 }
  }

  const total = polygonPerimeter(vertices)
  let distance = (((t % 1) + 1) % 1) * total

  for (let index = 0; index < sides; index += 1) {
    const a = vertices[index]
    const b = vertices[(index + 1) % sides]
    const length = edgeLength(a, b)
    if (distance <= length + 1e-6 || index === sides - 1) {
      const u = length < 1e-6 ? 0 : clamp01(distance / length)
      const point = lerpPoint(a, b, u)
      const tangent = Math.atan2(b.y - a.y, b.x - a.x)
      // Outward normal: perpendicular to edge, pointing away from board center.
      let normal = tangent + Math.PI / 2
      const mid = lerpPoint(a, b, 0.5)
      const toMidX = mid.x - center.x
      const toMidY = mid.y - center.y
      const candidateX = Math.cos(normal)
      const candidateY = Math.sin(normal)
      if (candidateX * toMidX + candidateY * toMidY < 0) {
        normal += Math.PI
      }
      return { point, tangent, normal, edgeIndex: index }
    }
    distance -= length
  }

  const fallback = vertices[0]
  return {
    point: fallback,
    tangent: 0,
    normal: Math.atan2(fallback.y - center.y, fallback.x - center.x),
    edgeIndex: 0,
  }
}

type ProportionSet = {
  /** Outer silhouette circumradius — large homes live near this rim. */
  outerRadius: number
  /** Colored home depth (how far the wedge reaches inward). */
  homeInnerRadius: number
  /** Circumradius of the track-cell pentagon (cells sit on these edges). */
  trackRadius: number
  /** Slightly larger pentagon framing the track field. */
  trackFieldRadius: number
  /** Yard nest distance from center (token parking). */
  yardRadius: number
  /** Yard nest size along / across the radial axis. */
  yardRadialSpan: number
  yardTangentSpan: number
  /** Home-lane outer radius (first home cell, just inside the track). */
  homeLaneStart: number
  homeLaneStep: number
  /** Compact central finish circumradius. */
  finishRadius: number
  labelRadius: number
  rankRadius: number
  cellSize: number
  yardTokenRadius: number
  /** How wide the colored tip is along the outer edges (0–0.5). */
  homeEdgeSpan: number
  /**
   * Radial meander amplitude along each edge — lengthens the path with soft
   * turns so boxes can be larger without overlapping.
   */
  trackMeander: number
}

function proportionsFor(playerCount: number, size: number): ProportionSet {
  // Ludo-King style: large path boxes + edge meanders (soft turns).
  if (playerCount === 5 || playerCount === 6) {
    const n = playerCount
    const cellSize = playerCount === 5 ? 42 : 40
    // Base spacing a bit under cell size; meander adds the rest of the gap.
    const baseSpacing = cellSize * 0.82
    const trackRadius = Math.ceil(
      (baseSpacing * (n * CELLS_PER_PLAYER)) /
        (2 * n * Math.sin(Math.PI / n)) +
        10,
    )
    const trackMeander = cellSize * 0.38
    const trackFieldRadius = trackRadius + cellSize * 0.85 + trackMeander
    const homeInnerRadius = trackFieldRadius
    const outerRadius = size / 2 - 12
    const finishRadius = playerCount === 5 ? 88 : 96
    return {
      outerRadius,
      homeInnerRadius,
      trackRadius,
      trackFieldRadius,
      yardRadius: (outerRadius + homeInnerRadius) / 2 + 8,
      yardRadialSpan: playerCount === 5 ? 26 : 28,
      yardTangentSpan: playerCount === 5 ? 30 : 32,
      homeLaneStart: trackRadius - trackMeander - cellSize * 0.55,
      homeLaneStep: cellSize * 0.88,
      finishRadius,
      labelRadius: outerRadius - 14,
      rankRadius: homeInnerRadius + (outerRadius - homeInnerRadius) * 0.42,
      cellSize,
      yardTokenRadius: 14,
      homeEdgeSpan: playerCount === 5 ? 0.22 : 0.24,
      trackMeander,
    }
  }
  // Generic N ≥ 7 fallback (still true N-gon edge track).
  return {
    outerRadius: size / 2 - 10,
    homeInnerRadius: 170,
    trackRadius: 168,
    trackFieldRadius: 188,
    yardRadius: 250,
    yardRadialSpan: 22,
    yardTangentSpan: 26,
    homeLaneStart: 140,
    homeLaneStep: 14,
    finishRadius: 46,
    labelRadius: size / 2 - 22,
    rankRadius: 210,
    cellSize: playerCount >= 7 ? 12 : 15,
    yardTokenRadius: playerCount >= 7 ? 11 : 13,
    homeEdgeSpan: 0.32,
    trackMeander: 0,
  }
}

function yardSlotsForSector(
  angle: number,
  yardRadius: number,
  radialSpan: number,
  tangentSpan: number,
  center: Point,
): Point[] {
  const origin = polar(yardRadius, angle, center)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const offsets: Array<[number, number]> = [
    [-tangentSpan * 0.5, -radialSpan * 0.45],
    [tangentSpan * 0.5, -radialSpan * 0.45],
    [-tangentSpan * 0.5, radialSpan * 0.45],
    [tangentSpan * 0.5, radialSpan * 0.45],
  ]
  return offsets.map(([tangent, radial]) => ({
    x: origin.x + cos * radial - sin * tangent,
    y: origin.y + sin * radial + cos * tangent,
  }))
}

/**
 * Build a full board layout for `playerCount` seats.
 * Reusable for 5/6/7/8 — proportions are tuned for the classic 5-player look.
 */
export function generatePolygonBoardGeometry(
  playerCount: number,
  options?: {
    size?: number
    cellsPerPlayer?: number
    homeLength?: number
  },
): BoardGeometry {
  const size = options?.size ?? boardCanvasSize(playerCount)
  const center = { x: size / 2, y: size / 2 }
  const cellsPerPlayer = options?.cellsPerPlayer ?? CELLS_PER_PLAYER
  const homeLength = options?.homeLength ?? homeLengthForBoard(playerCount)
  const startAngle = boardStartAngle(playerCount)
  const sector = (Math.PI * 2) / playerCount
  const totalCells = playerCount * cellsPerPlayer
  const props = proportionsFor(playerCount, size)

  const outerPolygon = regularPolygonVertices(
    playerCount,
    props.outerRadius,
    startAngle,
    center,
  )
  const trackFieldPolygon = regularPolygonVertices(
    playerCount,
    props.trackFieldRadius,
    startAngle,
    center,
  )
  const trackPolygon = regularPolygonVertices(
    playerCount,
    props.trackRadius,
    startAngle,
    center,
  )
  const finishPolygon = regularPolygonVertices(
    playerCount,
    props.finishRadius,
    startAngle,
    center,
  )
  const homeInnerPolygon = regularPolygonVertices(
    playerCount,
    props.homeInnerRadius,
    startAngle,
    center,
  )

  const trackCells: TrackCellGeom[] = Array.from({ length: totalCells }, (_, index) => {
    // Vertex-aligned base path; soft radial meander adds turns + spacing.
    const { point: base, tangent, normal } = pointOnPolygonPerimeter(
      trackPolygon,
      index / totalCells,
      center,
    )
    const alongEdge = (index % cellsPerPlayer) / cellsPerPlayer
    // Two soft bends per edge, flat at vertices (start cells stay on the corner).
    const wave = Math.sin(alongEdge * Math.PI * 2)
    const envelope = Math.sin(alongEdge * Math.PI) // 0 at vertices, 1 mid-edge
    const meander = props.trackMeander * wave * envelope
    const point = {
      x: base.x + Math.cos(normal) * meander,
      y: base.y + Math.sin(normal) * meander,
    }
    return { index, point, tangent, normal }
  })

  const sectors: PlayerSectorGeom[] = Array.from({ length: playerCount }, (_, seat) => {
    const angle = startAngle + seat * sector
    const prev = (seat - 1 + playerCount) % playerCount
    const next = (seat + 1) % playerCount

    // Large triangular / kite home occupying the outer corner (Ludo-King style).
    const tip = outerPolygon[seat]
    const leftOuter = lerpPoint(outerPolygon[seat], outerPolygon[prev], props.homeEdgeSpan)
    const rightOuter = lerpPoint(outerPolygon[seat], outerPolygon[next], props.homeEdgeSpan)
    const leftInner = lerpPoint(homeInnerPolygon[seat], homeInnerPolygon[prev], 0.22)
    const rightInner = lerpPoint(homeInnerPolygon[seat], homeInnerPolygon[next], 0.22)
    const homeBase = homeInnerPolygon[seat]
    const homePolygon = [tip, rightOuter, rightInner, homeBase, leftInner, leftOuter]

    // White yard nest — rounded diamond inside the colored tip.
    const yardOrigin = polar(props.yardRadius, angle, center)
    const yardPolygon = [
      {
        x: yardOrigin.x + Math.cos(angle) * -props.yardRadialSpan - Math.sin(angle) * -props.yardTangentSpan,
        y: yardOrigin.y + Math.sin(angle) * -props.yardRadialSpan + Math.cos(angle) * -props.yardTangentSpan,
      },
      {
        x: yardOrigin.x + Math.cos(angle) * -props.yardRadialSpan - Math.sin(angle) * props.yardTangentSpan,
        y: yardOrigin.y + Math.sin(angle) * -props.yardRadialSpan + Math.cos(angle) * props.yardTangentSpan,
      },
      {
        x: yardOrigin.x + Math.cos(angle) * props.yardRadialSpan - Math.sin(angle) * props.yardTangentSpan,
        y: yardOrigin.y + Math.sin(angle) * props.yardRadialSpan + Math.cos(angle) * props.yardTangentSpan,
      },
      {
        x: yardOrigin.x + Math.cos(angle) * props.yardRadialSpan - Math.sin(angle) * -props.yardTangentSpan,
        y: yardOrigin.y + Math.sin(angle) * props.yardRadialSpan + Math.cos(angle) * -props.yardTangentSpan,
      },
    ]

    const homeLane = Array.from({ length: homeLength }, (_, step) =>
      polar(props.homeLaneStart - step * props.homeLaneStep, angle, center),
    )

    const finishSector = [
      center,
      polar(props.finishRadius, angle - sector / 2, center),
      polar(props.finishRadius, angle + sector / 2, center),
    ]

    return {
      seat,
      angle,
      homePolygon,
      yardPolygon,
      yardSlots: yardSlotsForSector(
        angle,
        props.yardRadius,
        props.yardRadialSpan,
        props.yardTangentSpan,
        center,
      ),
      homeLane,
      finishSector,
      labelPoint: polar(props.labelRadius, angle, center),
      rankPoint: polar(props.rankRadius, angle, center),
      startCellIndex: seat * cellsPerPlayer,
    }
  })

  return {
    size,
    center,
    playerCount,
    cellsPerPlayer,
    homeLength,
    outerPolygon,
    trackFieldPolygon,
    finishPolygon,
    trackCells,
    sectors,
    cellSize: props.cellSize,
    yardTokenRadius: props.yardTokenRadius,
  }
}

const geometryCache = new Map<string, BoardGeometry>()

/** Bump when proportions change so HMR does not reuse stale layouts. */
const GEOMETRY_REVISION = 7

export function getPolygonBoardGeometry(
  playerCount: number,
  homeLength?: number,
): BoardGeometry {
  const lanes = homeLength ?? homeLengthForBoard(playerCount)
  const key = `${GEOMETRY_REVISION}:${playerCount}:${lanes}`
  const cached = geometryCache.get(key)
  if (cached) return cached
  const geometry = generatePolygonBoardGeometry(playerCount, { homeLength: lanes })
  geometryCache.set(key, geometry)
  return geometry
}

export function polygonTrackPoint(
  geometry: BoardGeometry,
  cellIndex: number,
): TrackCellGeom {
  const total = geometry.trackCells.length
  const index = ((cellIndex % total) + total) % total
  return geometry.trackCells[index]
}

export function polygonTokenPoint(
  geometry: BoardGeometry,
  seat: number,
  progress: number,
  homeEntry: number,
  finished: number,
  tokenId: number,
): Point {
  const sector = geometry.sectors[seat]
  if (!sector) return geometry.center

  if (progress < 0) {
    return sector.yardSlots[tokenId] ?? sector.yardSlots[0]
  }
  if (progress >= finished) {
    const angle = sector.angle
    const finishR =
      Math.hypot(
        geometry.finishPolygon[0].x - geometry.center.x,
        geometry.finishPolygon[0].y - geometry.center.y,
      ) || 48
    const radialDistance = tokenId < 2 ? finishR * 0.38 : finishR * 0.68
    const tangentDistance = tokenId % 2 === 0 ? -7 : 7
    const base = polar(radialDistance, angle, geometry.center)
    return {
      x: base.x - Math.sin(angle) * tangentDistance,
      y: base.y + Math.cos(angle) * tangentDistance,
    }
  }
  if (progress >= homeEntry) {
    const step = Math.min(
      geometry.homeLength - 1,
      Math.max(0, Math.floor(progress - homeEntry)),
    )
    return sector.homeLane[step] ?? sector.homeLane[sector.homeLane.length - 1]
  }

  // On the shared outer track — progress is relative; caller passes global cell via index.
  // This branch is unused when caller supplies global cell; kept for completeness.
  const cell = polygonTrackPoint(geometry, sector.startCellIndex + progress)
  return cell.point
}
