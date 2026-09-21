import type { DiffOp } from '../lib/types'
import { GROUP_OF_KIND, KINDS, type MistakeGroup } from '../lib/mistakes'

interface Props {
  ops: DiffOp[]
  onPick?: (index: number, op: DiffOp) => void
  /** Only mark this family of mistakes; everything else reads as plain text. */
  only?: MistakeGroup | null
}

function describe(op: DiffOp): string {
  const kinds = (op.k ?? []).map((k) => KINDS[k].label).join(', ')
  switch (op.t) {
    case 'd': return `Missed word: “${op.m}”`
    case 'i': return `${kinds}: “${op.a}” was not in the dictation`
    case 's': return `${kinds}: you typed “${op.a}”, the dictation says “${op.m}”`
    default: return `${kinds}: you typed “${op.a}”, the dictation says “${op.m}”`
  }
}

export function DiffView({ ops, onPick, only = null }: Props) {
  return (
    <p className={`diff ${only ? 'is-filtered' : ''}`}>
      {ops.map((op, i) => {
        const glue = (op.m ?? op.a ?? '').endsWith('-') ? '' : ' '
        if (only && !(op.k ?? []).some((k) => GROUP_OF_KIND[k] === only)) {
          // Not the chosen kind: show the dictated word as ordinary text (an extra word is not part of the dictation, so it is left out).
          if (op.t === 'i') return null
          return <span key={i}><span className="tok-dim">{op.m}</span>{glue}</span>
        }
        const pick = onPick ? () => onPick(i, op) : undefined
        const btn = (cls: string, text: string) => (
          <button key="w" type="button" className={`tok tok-btn ${cls}`} title={describe(op)} onClick={pick}>{text}</button>
        )

        let content
        if (op.t === 'm') {
          if (!op.k?.length) content = <span>{op.m}</span>
          else content = btn(op.k.includes('all_caps') ? 'tok-full' : 'tok-half', op.m ?? '')
        } else if (op.t === 's') {
          content = (
            <>
              {btn('tok-wrong', op.a ?? '')}
              <span className="tok tok-fix" title="What the dictation says">{op.m}</span>
            </>
          )
        } else if (op.t === 'd') {
          content = btn('tok-miss', op.m ?? '')
        } else {
          content = btn('tok-add', op.a ?? '')
        }
        return <span key={i}>{content}{glue}</span>
      })}
    </p>
  )
}

export function DiffLegend() {
  return (
    <div className="legend" aria-label="Legend">
      <span className="tok tok-full">Full mistake</span>
      <span className="tok tok-half">Half mistake</span>
      <span className="tok tok-miss">Missed word</span>
      <span className="tok tok-add">Extra word</span>
      <span><span className="tok tok-wrong">wrong</span><span className="tok tok-fix">correct</span></span>
    </div>
  )
}
