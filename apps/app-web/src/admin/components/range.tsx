import { Tabs, TabsList, TabsTrigger } from "@even/ui/components/tabs"
import { useI18n } from "@/admin/i18n"

export const RANGES = [7, 30, 90, 365] as const
export type Range = (typeof RANGES)[number]

/** A row of choices, such as the period or the site. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <Tabs value={String(value)} onValueChange={(next) => onChange(options.find((o) => String(o.value) === next)!.value)}>
      <TabsList aria-label={label}>
        {options.map((option) => (
          <TabsTrigger key={String(option.value)} value={String(option.value)}>
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

export function RangePicker({ value, onChange }: { value: Range; onChange: (value: Range) => void }) {
  const t = useI18n().t.range
  return <Segmented value={value} onChange={onChange} label={t.label} options={RANGES.map((days) => ({ value: days, label: t[days]! }))} />
}
