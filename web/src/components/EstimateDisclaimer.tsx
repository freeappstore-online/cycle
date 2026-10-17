import type { Confidence } from '../predict'

/**
 * The medical and accuracy disclaimer shown wherever predictions appear
 * (Today, Calendar, Insights). With `confidence: 'low'` it says so first.
 */
export function EstimateDisclaimer({ confidence, className = '' }: { confidence?: Confidence; className?: string }) {
  return (
    <p className={`m-0 text-xs text-[var(--muted)] ${className}`}>
      {confidence === 'low' && (
        <>
          <strong className="text-[var(--ink)]">Low confidence:</strong> there isn't much history yet, or your cycles
          vary a lot, so the real dates may fall well outside the estimate.{' '}
        </>
      )}
      Period, ovulation and fertile-window dates are estimates. Actual dates may fall outside the shown ranges, especially with limited or irregular history.{' '}
      Estimates only, not medical advice. <strong className="text-[var(--ink)]">Do not use this app for contraception.</strong>{' '}
      Talk to a clinician about irregular cycles or symptoms that concern you.
    </p>
  )
}
