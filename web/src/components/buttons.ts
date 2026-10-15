// Shared button classes, styled from the platform theme tokens.

const base =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50'

export const primaryButton = `${base} bg-[var(--ink)] text-[var(--paper)] hover:opacity-90`
export const secondaryButton = `${base} border border-[var(--line-strong)] bg-[var(--panel-strong)] text-[var(--ink)] hover:border-[var(--ink)]`
export const accentButton = `${base} border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)] hover:border-[var(--accent-deep)]`
export const dangerButton = `${base} border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-[var(--paper)]`
