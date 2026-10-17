import { secondaryButton } from '../../components/buttons'
import { EstimateDisclaimer } from '../../components/EstimateDisclaimer'
import { PREDICTION_METHOD, FERTILE_EXPLANATION } from '../../privacy/copy'

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
      <h3 className="mb-0 mt-3 text-sm font-bold">How estimates work</h3>
      <p className="mb-0 mt-2 text-sm">{PREDICTION_METHOD}</p>
      <p className="mb-0 mt-2 text-sm">{FERTILE_EXPLANATION}</p>
      {onShowIntro && (
        <button type="button" className={`${secondaryButton} mt-3`} onClick={onShowIntro}>
          Show the introduction again
        </button>
      )}
    </section>
  )
}
