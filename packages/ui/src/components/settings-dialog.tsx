import * as React from "react"
import { cn } from "cn"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, SearchIcon } from "@hugeicons/core-free-icons"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@evido/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@evido/ui/components/dialog"

export type SettingsLabels = {
  title: string
  description: string
  search: string
  noResults: string
  close: string
}

const defaultLabels: SettingsLabels = {
  title: "Settings",
  description: "Manage your account and preferences.",
  search: "Search",
  noResults: "No settings found.",
  close: "Close",
}

export type SettingsPage = {
  id: string
  label: string
  icon?: React.ReactNode
  /** Optional nav group heading, e.g. "Koppelingen". */
  group?: string
  /** Extra words the search box should match. */
  keywords?: string[]
}

/**
 * Large settings modal: searchable page navigation on the left, the active page
 * on the right. Shared by every Evido app; each app supplies its own pages.
 */
function SettingsDialog({
  open,
  onOpenChange,
  pages,
  activePage,
  onActivePageChange,
  labels: customLabels,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pages: SettingsPage[]
  activePage: string
  onActivePageChange: (id: string) => void
  /** Texts in the app's language; English by default. */
  labels?: Partial<SettingsLabels>
  children: React.ReactNode
}) {
  const labels = { ...defaultLabels, ...customLabels }
  const title = labels.title
  const [query, setQuery] = React.useState("")
  const active = pages.find((page) => page.id === activePage) ?? pages[0]
  const needle = query.trim().toLowerCase()
  const visible = needle
    ? pages.filter((page) =>
        [page.label, page.group ?? "", ...(page.keywords ?? [])].some((word) =>
          word.toLowerCase().includes(needle)
        )
      )
    : pages
  const groups = visible.reduce<Map<string, SettingsPage[]>>((map, page) => {
    const key = page.group ?? ""
    map.set(key, [...(map.get(key) ?? []), page])
    return map
  }, new Map())

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("")
        onOpenChange(next)
      }}
    >
      <DialogContent
        showCloseButton={false}
        // Focus the dialog itself, not the search field: on a tablet that would pop up the keyboard.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const content = event.currentTarget as HTMLElement | null
          content?.focus({ preventScroll: true })
        }}
        className="flex h-[min(760px,calc(100dvh-2rem))] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl md:flex-row"
      >
        <DialogDescription className="sr-only">
          {labels.description}
        </DialogDescription>
        <nav
          aria-label={title}
          className="flex shrink-0 flex-col gap-3 border-b bg-muted/40 p-3 md:w-64 md:border-r md:border-b-0"
        >
          <label className="relative hidden md:block">
            <span className="sr-only">{labels.search}</span>
            <HugeiconsIcon
              icon={SearchIcon}
              strokeWidth={2}
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={labels.search}
              className="h-9 w-full rounded-md bg-background pr-3 pl-9 text-sm ring-1 ring-border outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {/* Padding keeps the active item's ring inside the scroll clip. */}
          <div className="-m-1 flex gap-1 overflow-x-auto p-1 md:flex-col md:gap-4 md:overflow-y-auto">
            {[...groups].map(([group, items]) => (
              <div key={group} className="flex gap-1 md:flex-col">
                {group && (
                  <p className="hidden px-3 pb-1 text-xs text-muted-foreground md:block">
                    {group}
                  </p>
                )}
                {items.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    aria-current={page.id === active?.id ? "page" : undefined}
                    onClick={() => onActivePageChange(page.id)}
                    className={cn(
                      "flex shrink-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
                      // The active item keeps its own look on hover.
                      page.id === active?.id
                        ? "bg-background font-medium text-foreground shadow-xs ring-1 ring-border"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {page.icon}
                    {page.label}
                  </button>
                ))}
              </div>
            ))}
            {!visible.length && (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                {labels.noResults}
              </p>
            )}
          </div>
        </nav>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-5">
            <DialogTitle className="flex items-center gap-2 text-sm font-normal">
              <span className="text-muted-foreground">{title}</span>
              <span aria-hidden="true" className="text-muted-foreground">
                /
              </span>
              <span className="font-medium">{active?.label}</span>
            </DialogTitle>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={labels.close}>
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              </Button>
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-6 md:px-8 md:py-8">
              {children}
            </div>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}

/** A titled group of settings rows rendered as one card. */
function SettingsSection({
  title,
  description,
  destructive,
  className,
  children,
}: {
  title: string
  description?: string
  /** Danger zone: the heading is shown in the destructive colour. */
  destructive?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-1 px-1">
        <h2 className={cn("text-base font-semibold", destructive && "text-destructive")}>{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="divide-y overflow-hidden rounded-lg bg-card ring-1 ring-border">
        {children}
      </div>
    </section>
  )
}

/** One setting: label and help text on the left, its control on the right. */
function SettingsRow({
  title,
  description,
  htmlFor,
  destructive,
  children,
  footer,
}: {
  title: string
  description?: React.ReactNode
  htmlFor?: string
  destructive?: boolean
  children?: React.ReactNode
  /** Full-width content below the row, e.g. a confirmation message. */
  footer?: React.ReactNode
}) {
  const Label = htmlFor ? "label" : "p"
  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-1">
          <Label
            htmlFor={htmlFor}
            className={cn("text-sm font-medium", destructive && "text-destructive")}
          >
            {title}
          </Label>
          {description && (
            <div className="text-sm text-muted-foreground">{description}</div>
          )}
        </div>
        {children && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            {children}
          </div>
        )}
      </div>
      {footer}
    </div>
  )
}

export { SettingsDialog, SettingsSection, SettingsRow }
