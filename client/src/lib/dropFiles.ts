/**
 * The files in a drag-and-drop, including everything inside dropped folders.
 * The dropped items are only readable during the drop event itself, so they are all picked up before anything is awaited.
 */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((item) => item.webkitGetAsEntry?.() ?? null).filter((e): e is FileSystemEntry => e !== null)
  if (entries.length === 0) return [...dt.files]

  const out: File[] = []
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)))
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      for (;;) {
        // readEntries returns a few hundred entries at a time; an empty answer means the folder is finished.
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
        if (batch.length === 0) break
        for (const child of batch) await walk(child)
      }
    }
  }
  await Promise.all(entries.map(walk))
  return out
}

/** PDF files first, in natural order ("Volume 2" before "Volume 10"). The rest are counted so the admin can be told. */
export function pickPdfs(files: File[]): { pdfs: File[]; skipped: number } {
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name))
  pdfs.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }))
  return { pdfs, skipped: files.length - pdfs.length }
}
