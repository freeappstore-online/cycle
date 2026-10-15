// Chip-styled radio and checkbox groups. They're native inputs underneath, so
// arrow keys, Space and screen readers work as usual; a ✓ marks the selected
// chips so colour isn't the only signal.

import { useId } from 'react'

interface ChipProps {
  type: 'radio' | 'checkbox'
  name: string
  label: string
  checked: boolean
  onChange: () => void
}

function Chip({ type, name, label, checked, onChange }: ChipProps) {
  return (
    <label className="relative inline-flex cursor-pointer">
      <input type={type} name={name} checked={checked} onChange={onChange} className="peer sr-only" />
      <span
        className={
          'inline-flex min-h-10 items-center gap-1 rounded-full border px-3 text-sm font-semibold ' +
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--sky)] ' +
          (checked
            ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]'
            : 'border-[var(--line-strong)] bg-[var(--panel-strong)] text-[var(--muted)] hover:text-[var(--ink)]')
        }
      >
        {checked && <span aria-hidden="true">✓</span>}
        {label}
      </span>
    </label>
  )
}

function Group({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-2 p-0 text-sm font-bold text-[var(--ink)]">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  )
}

export interface RadioChipsProps<T extends string> {
  legend: string
  options: readonly T[]
  labels: Record<T, string>
  value: T | undefined
  onChange: (value: T | undefined) => void
  /** Label for the "nothing selected" choice. */
  noneLabel: string
}

export function RadioChips<T extends string>({ legend, options, labels, value, onChange, noneLabel }: RadioChipsProps<T>) {
  const name = useId()
  return (
    <Group legend={legend}>
      <Chip type="radio" name={name} label={noneLabel} checked={value === undefined} onChange={() => onChange(undefined)} />
      {options.map((o) => (
        <Chip key={o} type="radio" name={name} label={labels[o]} checked={value === o} onChange={() => onChange(o)} />
      ))}
    </Group>
  )
}

export interface CheckboxChipsProps<T extends string> {
  legend: string
  options: readonly T[]
  labels: Record<T, string>
  value: readonly T[]
  onChange: (value: T[]) => void
}

export function CheckboxChips<T extends string>({ legend, options, labels, value, onChange }: CheckboxChipsProps<T>) {
  const name = useId()
  const toggle = (o: T) => onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o])
  return (
    <Group legend={legend}>
      {options.map((o) => (
        <Chip key={o} type="checkbox" name={name} label={labels[o]} checked={value.includes(o)} onChange={() => toggle(o)} />
      ))}
    </Group>
  )
}
