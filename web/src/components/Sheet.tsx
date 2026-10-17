// The SDK Modal (backdrop, Escape, click-outside) with dialog semantics on top:
// role="dialog", a labelled heading, focus moved in on open, Tab kept inside,
// and focus returned to whatever opened it on close.

import { Modal } from '@freeappstore/sdk/ui'
import { type ReactNode, useEffect, useId, useRef } from 'react'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]'

export function Sheet({ open, onClose, title, children }: SheetProps) {
  const headingId = useId()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('h2')?.focus()
    return () => opener?.focus?.()
  }, [open])

  const trapTab = (e: React.KeyboardEvent) => {
    // Portalled children (e.g. a ConfirmDialog) bubble here too; only trap our own.
    if (e.key !== 'Tab' || !ref.current || !ref.current.contains(e.target as Node)) return
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter((item) => item.getClientRects().length > 0)
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current.querySelector('h2'))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth={520}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={headingId} onKeyDown={trapTab} className="min-w-0 break-words">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={headingId} tabIndex={-1} className="display-font m-0 text-xl font-semibold outline-none">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 text-2xl leading-none text-[var(--muted)] hover:text-[var(--ink)]"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </Modal>
  )
}
