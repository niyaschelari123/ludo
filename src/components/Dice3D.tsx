import { useMemo } from 'react'

const FACE_ROTATIONS: Record<number, string> = {
  1: 'rotateX(0deg) rotateY(0deg)',
  2: 'rotateY(-90deg)',
  3: 'rotateX(-90deg)',
  4: 'rotateX(90deg)',
  5: 'rotateY(90deg)',
  6: 'rotateX(180deg) rotateY(0deg)',
}

const PIP_LAYOUT: Record<number, [number, number][]> = {
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [3, 1], [1, 3], [3, 3]],
  5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]],
  6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]],
}

function DiceFace({ value }: { value: number }) {
  return (
    <div className="dice-face" aria-hidden="true">
      <div className="dice-pip-grid">
        {PIP_LAYOUT[value].map(([col, row]) => (
          <span
            key={`${col}-${row}`}
            className="dice-pip"
            style={{ gridColumn: col, gridRow: row }}
          />
        ))}
      </div>
    </div>
  )
}

interface Dice3DProps {
  value: number | null
  rolling: boolean
}

export function Dice3D({ value, rolling }: Dice3DProps) {
  const display = value && value >= 1 && value <= 6 ? value : 1
  const transform = useMemo(
    () => FACE_ROTATIONS[display] ?? FACE_ROTATIONS[1],
    [display],
  )

  return (
    <div
      className={`dice-scene ${rolling ? 'is-rolling' : ''} ${value ? 'has-value' : ''}`}
      role="img"
      aria-label={rolling ? 'Dice rolling' : value ? `Dice showing ${value}` : 'Dice'}
    >
      <div
        className="dice-cube"
        style={rolling ? undefined : { transform }}
      >
        <div className="dice-side dice-side--front"><DiceFace value={1} /></div>
        <div className="dice-side dice-side--back"><DiceFace value={6} /></div>
        <div className="dice-side dice-side--right"><DiceFace value={2} /></div>
        <div className="dice-side dice-side--left"><DiceFace value={5} /></div>
        <div className="dice-side dice-side--top"><DiceFace value={3} /></div>
        <div className="dice-side dice-side--bottom"><DiceFace value={4} /></div>
      </div>
    </div>
  )
}
