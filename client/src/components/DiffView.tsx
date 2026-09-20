import type { DiffOp } from '../lib/types'
import { KINDS } from '../lib/mistakes'

interface Props {
  ops: DiffOp[]
  onPick?: (index: number, op: DiffOp) => void
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

export function DiffView({ ops, onPick }: Props) {
  return (
    <p className="diff">
      {ops.map((op, i) => {
        const glue = (op.m ?? op.a ?? '').endsWith('-') ? '' : ' '
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
