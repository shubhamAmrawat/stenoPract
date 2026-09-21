import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { breaksFor } from '../lib/breaks'
import { KINDS } from '../lib/mistakes'
import type { DiffOp } from '../lib/types'

type Side = 'typed' | 'master'

interface Cell {
  text: string
  /** CSS class for the word. */
  cls: string
  /** A gap: the word is not in this column, it is shown faintly so the two columns line up. */
  ghost: boolean
  /** Part of a mistake (can be hovered, focused and stepped to). */
  bad: boolean
  /** Line breaks that came before this word in the original text (0, 1 or 2+). */
  br: number
}

interface Props {
  ops: DiffOp[]
  typedText: string
  masterText: string
  /** Lets the student report a dictation problem for a marked word (same as on the marked-up tab). */
  onReport?: (index: number, op: DiffOp) => void
}

const isMistake = (op: DiffOp) => op.t !== 'm' || (op.k?.length ?? 0) > 0
const weightOf = (op: DiffOp): 'full' | 'half' => ((op.k ?? []).some((k) => KINDS[k].weight === 1) ? 'full' : 'half')

function cellFor(op: DiffOp, side: Side): Omit<Cell, 'br'> {
  const w = weightOf(op)
  switch (op.t) {
    case 'm':
      return isMistake(op)
        ? { text: (side === 'typed' ? op.a : op.m) ?? '', cls: `cmp-${w}`, ghost: false, bad: true }
        : { text: (side === 'typed' ? op.a : op.m) ?? '', cls: 'cmp-ok', ghost: false, bad: false }
    case 's':
      return side === 'typed'
        ? { text: op.a ?? '', cls: `cmp-${w} cmp-sub`, ghost: false, bad: true }
        : { text: op.m ?? '', cls: 'cmp-fix', ghost: false, bad: true }
    case 'd':
      return side === 'master'
        ? { text: op.m ?? '', cls: 'cmp-miss', ghost: false, bad: true }
        : { text: op.m ?? '', cls: 'cmp-ghost', ghost: true, bad: true }
    default:
      return side === 'typed'
        ? { text: op.a ?? '', cls: 'cmp-add', ghost: false, bad: true }
        : { text: op.a ?? '', cls: 'cmp-ghost', ghost: true, bad: true }
  }
}

function sentence(op: DiffOp): string {
  switch (op.t) {
    case 'd': return `You missed “${op.m}”.`
    case 'i': return `You typed “${op.a}”, which is not in the dictation here.`
    default: return `You typed “${op.a}”; the dictation says “${op.m}”.`
  }
}

interface WordProps {
  i: number
  side: Side
  cell: Cell
  active: boolean
  onEnter: (i: number) => void
  onLeave: () => void
  onPick: (i: number) => void
  first: boolean
}

const Word = memo(function Word({ i, side, cell, active, onEnter, onLeave, onPick, first }: WordProps) {
  const glue = cell.text.endsWith('-') ? '' : ' '
  const breaks = first ? null : (
    <>
      {cell.br >= 1 && <br />}
      {cell.br >= 2 && <span className="cmp-para" />}
    </>
  )
  if (!cell.bad) return <>{breaks}<span className={`cmp-w ${cell.cls}`}>{cell.text}</span>{glue}</>
  return (
    <>
      {breaks}
      <button
        type="button"
        className={`cmp-w cmp-btn ${cell.cls} ${active ? 'is-active' : ''}`}
        data-i={i}
        data-side={side}
        aria-pressed={active}
        aria-label={cell.ghost ? `${side === 'typed' ? 'Missing' : 'Extra'} word: ${cell.text}` : undefined}
        onMouseEnter={() => onEnter(i)}
        onMouseLeave={onLeave}
        onFocus={() => onEnter(i)}
        onBlur={onLeave}
        onClick={() => onPick(i)}
      >
        {cell.text}
      </button>
      {glue}
    </>
  )
})

export function SideBySide({ ops: rawOps, typedText, masterText, onReport }: Props) {
  const ops = rawOps ?? []
  const [hover, setHover] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const columns = useMemo(() => {
    const typedBr = breaksFor(ops.map((o) => (o.t === 'd' ? undefined : o.a)), typedText)
    const masterBr = breaksFor(ops.map((o) => (o.t === 'i' ? undefined : o.m)), masterText)
    return {
      typed: ops.map((o, i): Cell => ({ ...cellFor(o, 'typed'), br: o.t === 'd' ? 0 : typedBr[i]! })),
      master: ops.map((o, i): Cell => ({ ...cellFor(o, 'master'), br: o.t === 'i' ? 0 : masterBr[i]! })),
    }
  }, [ops, typedText, masterText])

  const marked = useMemo(() => ops.flatMap((o, i) => (isMistake(o) ? [i] : [])), [ops])
  // Hovering previews a word; leaving goes back to the one that was clicked (pinned) or stepped to.
  const active = hover ?? pinned
  const activeOp = active === null ? null : ops[active]
  const from = pinned ?? hover
  const at = from === null ? -1 : marked.indexOf(from)

  const enter = useCallback((i: number) => setHover(i), [])
  const leave = useCallback(() => setHover(null), [])
  const pick = useCallback((i: number) => setPinned((p) => (p === i ? null : i)), [])

  const step = (dir: 1 | -1) => {
    if (marked.length === 0) return
    const next = at === -1 ? (dir === 1 ? 0 : marked.length - 1) : (at + dir + marked.length) % marked.length
    const i = marked[next]!
    setPinned(i)
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    rootRef.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }

  const noText = typedText.trim() === ''

  const column = (side: Side, title: string) => {
    const cells = columns[side]
    return (
      <div className="cmp-col">
        <h3>{title}</h3>
        <p className="cmp-text">
          {side === 'typed' && noText
            ? <span className="muted">(nothing typed)</span>
            : cells.map((c, i) => (
                <Word key={i} i={i} side={side} cell={c} active={active === i} onEnter={enter} onLeave={leave} onPick={pick} first={i === 0} />
              ))}
        </p>
      </div>
    )
  }

  return (
    <div className={`cmp ${focusMode ? 'cmp-focus' : ''}`} ref={rootRef}>
      <div className="cmp-panel">
        <div className="cmp-bar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => step(-1)} disabled={marked.length === 0} aria-label="Previous marked word">← Prev</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => step(1)} disabled={marked.length === 0} aria-label="Next marked word">Next →</button>
          <span className="cmp-count muted small" aria-live="polite">
            {marked.length === 0 ? 'No marked words' : at === -1 ? `${marked.length} marked word${marked.length === 1 ? '' : 's'}` : `Marked word ${at + 1} of ${marked.length}`}
          </span>
          <label className="cmp-switch">
            <input type="checkbox" checked={focusMode} onChange={(e) => setFocusMode(e.target.checked)} disabled={marked.length === 0} />
            <span>Focus on mistakes</span>
          </label>
        </div>

        <div className="cmp-info" aria-live="polite">
          {marked.length === 0 ? (
            <span className="muted">No mistakes. Perfect transcription!</span>
          ) : activeOp && active !== null ? (
            <>
              <div className="row" style={{ gap: 6 }}>
                {(activeOp.k ?? []).map((k) => (
                  <span key={k} className={`badge ${KINDS[k].weight === 1 ? 'badge-full' : 'badge-half'}`}>{KINDS[k].label} · {KINDS[k].weight === 1 ? 'full' : 'half'}</span>
                ))}
                <span>{sentence(activeOp)}</span>
              </div>
              <div className="cmp-foot small">
                <span className="muted cmp-short">{(activeOp.k ?? []).map((k) => KINDS[k].short).join(' · ')}</span>
                {onReport && <button type="button" className="cmp-link" onClick={() => onReport(active, activeOp)}>Dictation text wrong? Report it</button>}
              </div>
            </>
          ) : (
            <span className="muted">Hover or tap a highlighted word to see what went wrong. Use Prev / Next to step through them.</span>
          )}
        </div>
      </div>

      <div className="cmp-legend" aria-label="Legend">
        <span className="cmp-w cmp-full">Full mistake</span>
        <span className="cmp-w cmp-half">Half mistake</span>
        <span className="cmp-w cmp-miss">Missed word</span>
        <span className="cmp-w cmp-add">Extra word</span>
        <span className="cmp-w cmp-fix">Correct word</span>
        <span className="cmp-w cmp-ghost">Gap</span>
      </div>

      <div className="cmp-cols">
        {column('typed', 'What you typed')}
        {column('master', 'The dictation')}
      </div>
    </div>
  )
}
