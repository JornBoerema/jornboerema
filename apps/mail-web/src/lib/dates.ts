/** Time for today, a short date otherwise, with the year only when it isn't this one. */
export function shortDate(iso: string, locale: string) {
  const date = new Date(iso)
  const now = new Date()
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    })
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  })
}
