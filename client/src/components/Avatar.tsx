import { useState } from 'react'

/** Soft two-colour pairs for the letter avatar, so everyone without a photo still gets a picture of their own. */
const PALETTE: [string, string][] = [
  ['#4f46e5', '#7c6bf2'],
  ['#ff7a59', '#ff9f80'],
  ['#0d9488', '#34b3a5'],
  ['#c026d3', '#e27bef'],
  ['#2563eb', '#5f9bf5'],
  ['#d97706', '#f2b04a'],
]

function pick(name: string): [string, string] {
  let h = 0
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]!
}

/** A round profile picture. Without a picture (or when it fails to load) it shows the first letter of the name on a colour picked from the name. */
export function Avatar({ name, picture, size = 34 }: { name: string; picture: string | null; size?: number }) {
  // Remember which address failed, so a new picture gets a fresh try.
  const [failed, setFailed] = useState<string | null>(null)
  const showPhoto = picture && failed !== picture
  const [from, to] = pick(name)
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), ...(showPhoto ? {} : { background: `linear-gradient(135deg, ${from}, ${to})`, color: '#fff' }) }}
      aria-hidden="true"
    >
      {showPhoto ? <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setFailed(picture)} /> : (name.trim().charAt(0) || '?').toUpperCase()}
    </span>
  )
}
