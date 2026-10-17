import { Sheet } from './Sheet'
import { dangerButton, primaryButton, secondaryButton } from './buttons'

/** Confirmation dialogs share the editor's naming, focus trap and focus return. */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', variant, onCancel, onConfirm }: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  variant?: 'danger' | 'default'
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Sheet open={open} title={title} onClose={onCancel}>
      <p className="mt-0 text-sm text-[var(--muted)]">{message}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={secondaryButton} onClick={onCancel}>Cancel</button>
        <button type="button" className={variant === 'danger' ? dangerButton : primaryButton} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Sheet>
  )
}
