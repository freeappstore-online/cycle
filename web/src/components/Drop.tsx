/** A drop icon: filled for logged period days, outlined for estimated ones. Decorative. */
export function Drop({ filled, className = 'h-3 w-3' }: { filled: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 12 16" className={className} aria-hidden="true" focusable="false">
      <path
        d="M6 1C6 1 1 7.2 1 10.5a5 5 0 0 0 10 0C11 7.2 6 1 6 1Z"
        fill={filled ? 'var(--accent)' : 'none'}
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}
