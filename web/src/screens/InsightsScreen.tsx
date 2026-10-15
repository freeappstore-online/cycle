// Insights: summary stats, a cycle-length chart and a symptom heatmap. Loaded
// lazily from App.tsx, so Recharts stays out of the main chunk.
//
// Colour is never the only signal: the chart has a legend, a text summary and
// a table view; outlier cycles are hatched and labelled; the heatmap is a
// table that prints every percentage, with shading as a second cue. All
// colours come from the theme tokens, so light and dark both work.

import { PageHeader } from '@freeappstore/sdk/ui'
import type { CSSProperties, ReactNode } from 'react'
import { Bar, CartesianGrid, Cell, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EstimateDisclaimer } from '../components/EstimateDisclaimer'
import { useCycleData } from '../data'
import { formatDayMonth, formatLong, plural } from '../dates'
import {
  type BinnedGrid,
  type CycleBar,
  type CycleRow,
  type SummaryStats,
  binSymptomGrid,
  buildSymptomGrid,
  computeSummaryStats,
  cycleChartData,
  deriveCycleRows,
} from '../insights/shape'

const card = 'rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-4'

// Theme-derived colours: one hue (accent) at different strengths.
const PERIOD_FILL = 'var(--accent)'
/** Lighter step of the same hue; stronger in dark mode so it holds up against a black page (index.css). */
const REST_FILL = 'var(--chart-rest)'
const HATCH_ID = 'cycle-outlier-hatch'
/** Sequential heatmap shade; capped at 60% so text stays readable in both themes. */
const heat = (freq: number) =>
  `color-mix(in oklab, var(--accent) calc(${Math.min(1, freq).toFixed(3)} * var(--chart-heat-max)), var(--paper))`

export default function InsightsScreen({ onNavigate }: { onNavigate?: (href: string) => void }) {
  const data = useCycleData(async (repo) => {
    const [periods, days] = await Promise.all([repo.listPeriods(), repo.listDays({ from: '0000-01-01', to: '9999-12-31' })])
    const rows = deriveCycleRows(periods)
    return {
      rows,
      stats: computeSummaryStats(rows, periods),
      chart: cycleChartData(rows),
      heatmap: binSymptomGrid(buildSymptomGrid(periods, days)),
    }
  })

  return (
    <>
      <PageHeader title="Insights" description="Cycle length, period length and symptom patterns from what you've logged." />
      {!data ? (
        <p className="text-[var(--muted)]">Loading…</p>
      ) : data.stats.cycleCount < 2 ? (
        <NotEnoughYet stats={data.stats} onNavigate={onNavigate} />
      ) : (
        <div className="flex flex-col gap-4">
          <Stats stats={data.stats} />
          <CycleChart rows={data.rows} chart={data.chart} stats={data.stats} />
          <Heatmap grid={data.heatmap} />
          <EstimateDisclaimer />
        </div>
      )}
    </>
  )
}

function NavLink({ href, onNavigate, children }: { href: string; onNavigate?: (href: string) => void; children: ReactNode }) {
  return (
    <a
      href={href}
      className="font-semibold underline"
      onClick={(e) => {
        if (!onNavigate) return
        e.preventDefault()
        onNavigate(href)
      }}
    >
      {children}
    </a>
  )
}

function NotEnoughYet({ stats, onNavigate }: { stats: SummaryStats; onNavigate?: (href: string) => void }) {
  const have = stats.cycleCount === 1 ? 'You have one complete cycle so far.' : 'There are no complete cycles yet.'
  return (
    <section className={card} aria-labelledby="insights-empty">
      <h2 id="insights-empty" className="m-0 text-base font-bold">
        Not enough cycles yet
      </h2>
      <p className="mb-0 mt-2 text-sm">
        {have} Charts appear once you've logged at least two complete cycles, which takes three period start dates.
      </p>
      <p className="mb-0 mt-2 text-sm">
        Log today on the <NavLink href="/" onNavigate={onNavigate}>Today</NavLink> screen, or add past periods on the{' '}
        <NavLink href="/calendar" onNavigate={onNavigate}>Calendar</NavLink>.
      </p>
    </section>
  )
}

function Stats({ stats }: { stats: SummaryStats }) {
  const tiles: { label: string; value: string; note?: string }[] = [
    { label: 'Average cycle', value: plural(stats.avgCycle!, 'day'), note: `range ${stats.shortest}–${stats.longest}` },
    { label: 'Average period', value: stats.avgPeriod === null ? '–' : plural(stats.avgPeriod, 'day') },
    { label: 'Variation', value: stats.stdDev === null ? '–' : `±${plural(stats.stdDev, 'day')}`, note: 'standard deviation' },
    {
      label: 'Cycles logged',
      value: String(stats.cycleCount),
      note: stats.excluded ? `${stats.excluded} more left out (under 15 or over 90 days)` : undefined,
    },
  ]
  return (
    <section aria-label="Summary">
      <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className={`${card} flex flex-col`}>
            <dt className="text-xs font-bold text-[var(--muted)]">{t.label}</dt>
            <dd className="m-0 mt-1 text-xl font-extrabold text-[var(--ink)]">{t.value}</dd>
            {t.note && <dd className="m-0 mt-0.5 text-xs text-[var(--muted)]">{t.note}</dd>}
          </div>
        ))}
      </dl>
    </section>
  )
}

function Swatch({ style }: { style: CSSProperties }) {
  return <span aria-hidden="true" className="inline-block h-3 w-3 shrink-0 rounded-[3px]" style={style} />
}

const HATCH_STYLE: CSSProperties = {
  backgroundColor: REST_FILL,
  backgroundImage: 'repeating-linear-gradient(45deg, var(--accent) 0 1.5px, transparent 1.5px 5px)',
}

function CycleTooltip({ active, payload }: { active?: boolean; payload?: { payload: CycleBar }[] }) {
  const bar = payload?.[0]?.payload
  if (!active || !bar) return null
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--panel-strong)] px-3 py-2 text-xs text-[var(--ink)] shadow-[var(--shadow-card)]">
      <p className="m-0 font-bold">
        Cycle {bar.index} · {formatDayMonth(bar.start)}
      </p>
      <p className="m-0">{plural(bar.length, 'day')}</p>
      <p className="m-0 text-[var(--muted)]">{bar.periodUnknown ? 'Period end not logged' : `Period ${plural(bar.periodDays, 'day')}`}</p>
      {bar.outlier && <p className="m-0 text-[var(--muted)]">Left out of the average</p>}
    </div>
  )
}

function CycleChart({ rows, chart, stats }: { rows: CycleRow[]; chart: ReturnType<typeof cycleChartData>; stats: SummaryStats }) {
  const { bars } = chart
  const avg = stats.avgCycle!
  const usual = bars.filter((b) => !b.outlier).map((b) => b.length)
  const shortOutliers = bars.length - usual.length
  // Weekly gridlines read naturally for cycles (7, 14, 21, 28 …).
  const top = Math.ceil((Math.max(...bars.map((b) => b.length)) + 1) / 7) * 7
  const weekTicks = Array.from({ length: top / 7 + 1 }, (_, i) => i * 7)
  const summary =
    `Your last ${plural(bars.length, 'cycle')} on the chart ran from ${Math.min(...usual)} to ${Math.max(...usual)} days` +
    (shortOutliers ? ` (not counting ${shortOutliers} under 15 days, shown hatched)` : '') +
    `; the average is ${avg} days.` +
    (chart.hiddenLong ? ` ${plural(chart.hiddenLong, 'cycle')} over 90 days (probably a missed log) ${chart.hiddenLong === 1 ? 'is' : 'are'} left off the chart.` : '') +
    (chart.hiddenOlder ? ` ${plural(chart.hiddenOlder, 'older cycle')} ${chart.hiddenOlder === 1 ? 'is' : 'are'} in the table.` : '')
  const hasOutlier = bars.some((b) => b.outlier)

  return (
    <section className={card} aria-labelledby="cycle-chart-title">
      <figure className="m-0">
        <h2 id="cycle-chart-title" className="m-0 text-base font-bold">
          Cycle length
        </h2>
        <figcaption className="mt-1 text-sm text-[var(--muted)]">{summary}</figcaption>
        <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-[var(--ink)]" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <Swatch style={{ background: PERIOD_FILL }} /> Period days
          </li>
          <li className="flex items-center gap-1.5">
            <Swatch style={{ background: REST_FILL }} /> Rest of cycle
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-0.5 w-4 bg-[var(--muted)]" /> Average ({plural(avg, 'day')})
          </li>
          {hasOutlier && (
            <li className="flex items-center gap-1.5">
              <Swatch style={HATCH_STYLE} /> Left out (under 15 days)
            </li>
          )}
        </ul>
        <div className="mt-2 h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={bars}
              margin={{ top: 16, right: 8, bottom: 0, left: -16 }}
              title="Cycle length per cycle"
              desc={summary}
              barCategoryGap="20%"
            >
              <defs>
                <pattern id={HATCH_ID} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="5" height="5" fill={REST_FILL} />
                  <line x1="0" y1="0" x2="0" y2="5" stroke={PERIOD_FILL} strokeWidth="1.5" />
                </pattern>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis
                dataKey="index"
                tickFormatter={(i: number) => formatDayMonth(bars.find((b) => b.index === i)!.start)}
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--line-strong)' }}
                interval="preserveStartEnd"
                minTickGap={8}
              />
              <YAxis
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                domain={[0, top]}
                ticks={weekTicks}
                unit="d"
              />
              <Tooltip content={<CycleTooltip />} cursor={{ fill: 'var(--line)' }} isAnimationActive={false} />
              <Bar dataKey="periodDays" stackId="cycle" maxBarSize={24} stroke="var(--paper)" strokeWidth={2} isAnimationActive={false} name="Period days">
                {bars.map((b) => (
                  <Cell key={b.index} fill={b.outlier ? `url(#${HATCH_ID})` : PERIOD_FILL} />
                ))}
              </Bar>
              <Bar
                dataKey="restDays"
                stackId="cycle"
                maxBarSize={24}
                radius={[4, 4, 0, 0]}
                stroke="var(--paper)"
                strokeWidth={2}
                isAnimationActive={false}
                name="Rest of cycle"
              >
                {bars.map((b) => (
                  <Cell key={b.index} fill={b.outlier ? `url(#${HATCH_ID})` : REST_FILL} />
                ))}
              </Bar>
              {/* Labelled in the legend; a label on the line collides with the bars. */}
              <ReferenceLine y={avg} stroke="var(--muted)" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <CycleTable rows={rows} />
    </section>
  )
}

function CycleTable({ rows }: { rows: CycleRow[] }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-semibold">Show all cycles as a table</summary>
      <div className="mt-2 max-h-72 overflow-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">All complete cycles, newest first</caption>
          <thead>
            <tr className="text-xs text-[var(--muted)]">
              <th scope="col" className="py-1 pr-2 font-bold">
                Started
              </th>
              <th scope="col" className="py-1 pr-2 font-bold">
                Cycle
              </th>
              <th scope="col" className="py-1 font-bold">
                Period
              </th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.index} className="border-t border-[var(--line)]">
                <th scope="row" className="py-1 pr-2 font-normal">
                  {formatLong(r.start)}
                </th>
                <td className="py-1 pr-2">
                  {plural(r.length, 'day')}
                  {r.outlier && <span className="text-[var(--muted)]"> (left out)</span>}
                </td>
                <td className="py-1">{r.periodLength === undefined ? '–' : plural(r.periodLength, 'day')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function Heatmap({ grid }: { grid: BinnedGrid }) {
  if (grid.rows.length === 0) {
    return (
      <section className={card} aria-labelledby="heatmap-title">
        <h2 id="heatmap-title" className="m-0 text-base font-bold">
          Symptoms by cycle day
        </h2>
        <p className="mb-0 mt-2 text-sm text-[var(--muted)]">
          No symptoms logged during your complete cycles yet. Add them when you log a day and patterns show up here.
        </p>
      </section>
    )
  }
  return (
    <section className={card} aria-labelledby="heatmap-title">
      <h2 id="heatmap-title" className="m-0 text-base font-bold">
        Symptoms by cycle day
      </h2>
      <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
        The share of cycle days in each range with the symptom logged. Day 1 is the first day of a period.
      </p>
      <div className="mt-3 overflow-x-auto" role="region" aria-labelledby="heatmap-title" tabIndex={0}>
        <table className="w-full border-separate border-spacing-0.5 text-center text-xs">
          <caption className="sr-only">
            Percentage of cycle days with each symptom logged, by range of cycle days. Higher percentages are also shaded darker.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="px-1 py-1 text-left font-bold text-[var(--muted)]">
                Symptom
              </th>
              {grid.columns.map((c) => (
                <th key={c.from} scope="col" className="min-w-11 px-1 py-1 font-bold text-[var(--muted)]">
                  {c.label.replace('Days ', '')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={r.symptom}>
                <th scope="row" className="whitespace-nowrap px-1 py-1 text-left font-semibold text-[var(--ink)]">
                  {r.label}
                </th>
                {r.cells.map((cell, i) => {
                  const pct = Math.round(cell.freq * 100)
                  return (
                    <td
                      key={grid.columns[i].from}
                      title={`${r.label}, ${grid.columns[i].label.toLowerCase()}: ${cell.count} of ${cell.days} cycle days (${pct}%)`}
                      className="rounded-[4px] px-1 py-1.5 tabular-nums text-[var(--ink)]"
                      style={{ background: heat(cell.freq) }}
                    >
                      {cell.count === 0 ? (
                        <>
                          <span aria-hidden="true" className="text-[var(--muted)]">
                            –
                          </span>
                          <span className="sr-only">0%</span>
                        </>
                      ) : (
                        `${pct}%`
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-[var(--muted)]" aria-hidden="true">
        <span>0%</span>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f} className="inline-block h-3 w-6 rounded-[3px] border border-[var(--line)]" style={{ background: heat(f) }} />
        ))}
        <span>100%</span>
      </div>
    </section>
  )
}
