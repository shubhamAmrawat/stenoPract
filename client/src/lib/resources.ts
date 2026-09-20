/** Google Drive share links do not download directly; turn them into a direct-download link. Everything else is used as is. */
export function downloadUrl(url: string): string {
  const m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/) ?? url.match(/drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([\w-]+)/)
  return m ? `https://drive.google.com/uc?export=download&id=${m[1]}` : url
}

/**
 * Saves a file from our own storage under a proper name. Browsers ignore the "download" attribute on links to another site,
 * so the file is fetched first and saved from memory. If that is not possible (for example the storage does not allow it yet),
 * the file simply opens in a new tab, where the PDF viewer has its own download button.
 */
export async function saveFile(url: string, title: string): Promise<void> {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(String(res.status))
    const href = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = href
    a.download = `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'file'}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 10_000)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
