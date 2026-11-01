// Shared button classes, styled from the platform theme tokens.

const base =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-fas-sm px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50'

export const primaryButton = `${base} bg-ink text-paper hover:opacity-90`
export const secondaryButton = `${base} border border-line-strong bg-panel-strong text-ink hover:border-ink`
export const accentButton = `${base} border border-accent bg-accent-soft text-ink hover:border-accent-deep`
export const dangerButton = `${base} border border-danger text-danger hover:bg-danger hover:text-paper`
