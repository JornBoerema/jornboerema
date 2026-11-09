import type { ComponentProps, ReactNode } from "react"
import { cn } from "@evido/ui/lib/utils"

/** A labelled line in a message form: the label on the left, its control filling the rest. */
export function MessageRow({
  label,
  action,
  children,
}: {
  label: string
  /** Sits at the end of the line, outside the label. */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-10 items-center gap-3 border-b px-4 text-sm transition-colors focus-within:bg-muted/40">
      <label className="flex min-w-0 flex-1 items-center gap-3">
        <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
        {children}
      </label>
      {action}
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

export function MessageText({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "w-full flex-1 resize-none bg-transparent px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}
