import { useSearchParams } from "react-router"
import { RANGES, type Range } from "@/admin/components/range"

/** The period in the address (?days=90), so a view can be shared and survives a reload. */
export function useRange(): [Range, (days: Range) => void] {
  const [params, setParams] = useSearchParams()
  const days = Number(params.get("days"))
  const range = ((RANGES as readonly number[]).includes(days) ? days : 30) as Range
  const set = (next: Range) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (next === 30) copy.delete("days")
        else copy.set("days", String(next))
        return copy
      },
      { replace: true }
    )
  return [range, set]
}
