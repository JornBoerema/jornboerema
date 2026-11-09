import type { ComponentProps, ReactNode } from "react"
import { cn } from "@evido/ui/lib/utils"

/** A labelled line in a message form: the label on the left, its control filling the rest. */
export function MessageRow({
  label,
  htmlFor,
  action,
  children,
}: {
  label: string
  /** Needed when the row holds buttons, or clicking the label would press the first one. */
  htmlFor?: string
  /** Sits at the end of the line, outside the label. */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-10 items-start gap-3 rounded-lg px-4 text-sm transition-colors focus-within:bg-muted/40">
      <label htmlFor={htmlFor} className="flex min-h-10 min-w-0 flex-1 items-center gap-3">
        <span className="w-16 shrink-0 self-start pt-2.5 text-muted-foreground">{label}</span>
        {children}
      </label>
      {action && <div className="flex h-10 shrink-0 items-center">{action}</div>}
    </div>
  )
}

export function MessageInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}
