// The SDK Modal owns dialog semantics, focus trapping, Escape and focus return.
// Keep the app's heading and close control while using the SDK's opaque surface.
import { Modal } from '@freeappstore/sdk/ui'
import { type ReactNode, useId } from 'react'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
  const headingId = useId()

  return (
    <Modal open={open} onClose={onClose} ariaLabel={title} maxWidth={520}>
      <div className="min-w-0 break-words">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={headingId} data-autofocus tabIndex={-1} className="display-font m-0 text-xl font-semibold outline-none">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 text-2xl leading-none text-muted hover:text-ink"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </Modal>
  )
}
