import { useDeferredValue, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"
import { ArrowRight01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Avatar, AvatarFallback, AvatarImage } from "@even/ui/components/avatar"
import { Badge } from "@even/ui/components/badge"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@even/ui/components/input-group"
import { Skeleton } from "@even/ui/components/skeleton"
import { PageHeader } from "@/admin/components/stat"
import { useI18n } from "@/admin/i18n"
import { api } from "@/admin/lib/api"
import { useFormat } from "@/admin/lib/format"

export type UserRow = {
  id: string
  name: string
  email: string
  image: string | null
  emailVerified: boolean
  twoFactorEnabled: boolean
  createdAt: string
  providers: string[]
  mailboxes: number
  organizations: number
  passkeys: number
  lastSeen: string | null
}

export const initials = (person: { name: string; email: string }) =>
  (person.name || person.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")

export function UsersPage() {
  const t = useI18n().t.users
  const { ago, date, full } = useFormat()
  const [search, setSearch] = useState("")
  const q = useDeferredValue(search.trim())
  const users = useQuery({
    queryKey: ["admin-users", q],
    queryFn: () => api<{ users: UserRow[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`),
    placeholderData: (previous) => previous,
  })
  const list = users.data?.users ?? []

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader title={t.title} description={t.description} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <InputGroup className="max-w-sm">
          <InputGroupAddon>
            <HugeiconsIcon icon={Search01Icon} strokeWidth={2} aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t.search}
            aria-label={t.search}
          />
        </InputGroup>
        {users.data && <span className="text-xs text-muted-foreground">{t.count(list.length)}</span>}
      </div>
      {users.isError && <p className="text-sm text-destructive">{t.loadFailed}</p>}
      {users.isPending && <Skeleton className="h-80" />}
      {users.data && list.length === 0 && (
        <p className="rounded-2xl border border-dashed px-4 py-4 text-sm text-muted-foreground">{t.empty}</p>
      )}
      {list.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {list.map((user) => (
            <li key={user.id}>
              <Link
                to={`/users/${user.id}`}
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
              >
                <Avatar className="size-8">
                  {user.image && <AvatarImage src={user.image} alt="" />}
                  <AvatarFallback className="text-xs">{initials(user)}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{user.name || user.email}</span>
                    {!user.emailVerified && <Badge variant="outline">{t.unverified}</Badge>}
                    {user.twoFactorEnabled && <Badge variant="secondary">{t.twoFactor}</Badge>}
                    {user.passkeys > 0 && <Badge variant="secondary">{t.passkey}</Badge>}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user.email}
                    {user.providers.length > 0 && <> · {user.providers.map((id) => t.providers[id] ?? id).join(", ")}</>}
                    {user.mailboxes > 0 && <> · {t.mailboxes(user.mailboxes)}</>}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground tabular-nums max-sm:hidden">
                  <span title={full(user.createdAt)}>
                    {t.joined} {date(user.createdAt)}
                  </span>
                  <span title={full(user.lastSeen)}>
                    {t.lastSeen} {user.lastSeen ? ago(user.lastSeen) : t.never.toLowerCase()}
                  </span>
                </div>
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
