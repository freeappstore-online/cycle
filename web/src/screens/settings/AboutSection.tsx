import { secondaryButton } from '../../components/buttons'
import { EstimateDisclaimer } from '../../components/EstimateDisclaimer'

const card = 'rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4'

export function AboutSection({ onShowIntro }: { onShowIntro?: () => void }) {
  return (
    <section aria-labelledby="about-heading" className={card}>
      <h2 id="about-heading" className="m-0 text-base font-bold">
        About
      </h2>
      <p className="mb-0 mt-2 text-sm">
        Cycle is a free, MIT-licensed period tracker on{' '}
        <a href="https://freeappstore.online" className="underline">
          FreeAppStore
        </a>
        .
      </p>
      <EstimateDisclaimer className="mt-2" />
      {onShowIntro && (
        <button type="button" className={`${secondaryButton} mt-3`} onClick={onShowIntro}>
          Show the introduction again
        </button>
      )}
    </section>
  )
}
