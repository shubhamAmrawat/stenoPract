import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Modal } from './ui'
import { api, errorMessage } from '../lib/api'

interface Props {
  dictationId: string
  attemptId?: string
  word?: string
  wordIndex?: number
  kind?: 'transcript_error' | 'video_issue'
  onClose: () => void
}

export function ReportModal({ dictationId, attemptId, word, wordIndex, kind = 'transcript_error', onClose }: Props) {
  const [message, setMessage] = useState('')
  const send = useMutation({
    mutationFn: () =>
      api('/reports', { method: 'POST', body: { dictationId, attemptId, word, wordIndex, type: kind, message: message.trim() } }),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    send.mutate()
  }

  return (
    <Modal title={kind === 'video_issue' ? 'Report a video problem' : 'Report a transcript problem'} onClose={onClose}>
      {send.isSuccess ? (
        <>
          <div className="alert alert-info">Thanks! An admin will look at this and fix the transcript if needed.</div>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </>
      ) : (
        <form className="stack" onSubmit={submit}>
          {word && <div>Word: <span className="badge badge-half">{word}</span></div>}
          <div className="field">
            <label className="label" htmlFor="report-msg">What is wrong?</label>
            <textarea id="report-msg" className="textarea" rows={4} maxLength={1000} required minLength={3} value={message} onChange={(e) => setMessage(e.target.value)}
              placeholder={kind === 'video_issue' ? 'For example: the audio cuts off at 2:10' : 'For example: the speaker says “Hon’ble” here, not “Honourable”'} />
          </div>
          {send.error && <div className="alert alert-error">{errorMessage(send.error)}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={send.isPending || message.trim().length < 3}>{send.isPending ? 'Sending…' : 'Send report'}</button>
          </div>
        </form>
      )}
    </Modal>
  )
}
