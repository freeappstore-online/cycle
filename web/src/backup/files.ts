// Saving files made on the device: download through an object URL, or the
// Web Share API where it can share files. Nothing is uploaded.

type ShareNavigator = Navigator & {
  canShare?: (data: { files: File[] }) => boolean
  share?: (data: { files: File[]; title?: string }) => Promise<void>
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function canShareFiles(): boolean {
  const nav = navigator as ShareNavigator
  if (!nav.canShare || !nav.share) return false
  try {
    return nav.canShare({ files: [new File([''], 'test.json', { type: 'application/json' })] })
  } catch {
    return false
  }
}

/** Opens the share sheet. Resolves false if the user dismissed it. */
export async function shareBlob(blob: Blob, filename: string, title: string): Promise<boolean> {
  const nav = navigator as ShareNavigator
  try {
    await nav.share!({ files: [new File([blob], filename, { type: blob.type })], title })
    return true
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false
    throw err
  }
}
