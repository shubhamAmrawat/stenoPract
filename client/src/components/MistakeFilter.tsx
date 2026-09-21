import { GROUP_ORDER, GROUPS, type MistakeGroup } from '../lib/mistakes'

interface Props {
  counts: Record<MistakeGroup, number>
  value: MistakeGroup | null
  onChange: (g: MistakeGroup | null) => void
}

/** Chips that narrow the marked-up text, and the table under it, to one kind of mistake. */
export function MistakeFilter({ counts, value, onChange }: Props) {
  const total = GROUP_ORDER.reduce((n, g) => n + counts[g], 0)
  const present = GROUP_ORDER.filter((g) => counts[g] > 0)
  if (total === 0) return null
  return (
    <div className="chips" role="group" aria-label="Show mistakes of one kind">
      <button type="button" className="chip" aria-pressed={value === null} onClick={() => onChange(null)}>
        All <b>{total}</b>
      </button>
      {present.map((g) => (
        <button key={g} type="button" className="chip" aria-pressed={value === g} title={GROUPS[g].hint} onClick={() => onChange(value === g ? null : g)}>
          <span className="chip-dot" style={{ background: GROUPS[g].color }} aria-hidden="true" />
          {GROUPS[g].label} <b>{counts[g]}</b>
        </button>
      ))}
    </div>
  )
}
