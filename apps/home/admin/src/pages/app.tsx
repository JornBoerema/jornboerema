import { useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useParams } from "react-router"
import { toast } from "sonner"
import { ArrowLeft01Icon, ArrowUpRight01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@evido/ui/components/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@evido/ui/components/avatar"
import { Button } from "@evido/ui/components/button"
import { Input } from "@evido/ui/components/input"
import { useI18n } from "@/i18n"
import { api, errorText } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

type Person = { id: string; name: string; email: string; image: string | null }

type AppDetail = {
  app: { id: string; name: string; url: string; inviteOnly: boolean }
  members: (Person & { grantedAt: string; grantedBy: string | null })[]
  invites: { id: string; email: string; invitedBy: string | null; createdAt: string }[]
  requests: { id: string; createdAt: string; user: Person }[]
}

const initials = (person: { name: string; email: string }) =>
  (person.name || person.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")

function PersonLine({ person, detail }: { person: Person; detail?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Avatar className="size-8">
        {person.image && <AvatarImage src={person.image} alt="" />}
        <AvatarFallback className="text-xs">{initials(person)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{person.name || person.email}</span>
        <span className="truncate text-xs text-muted-foreground">
          {person.email}
          {detail && <> · {detail}</>}
        </span>
      </div>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-baseline gap-2 px-1 text-sm font-medium">
        {title}
        {count !== undefined && count > 0 && <span className="text-muted-foreground tabular-nums">{count}</span>}
      </h2>
      {children}
    </section>
  )
}

const List = ({ children }: { children: ReactNode }) => (
  <ul className="divide-y overflow-hidden rounded-2xl border">{children}</ul>
)

const Row = ({ children }: { children: ReactNode }) => (
  <li className="flex min-h-14 items-center gap-3 px-4 py-2.5">{children}</li>
)

const Quiet = ({ children }: { children: ReactNode }) => (
  <p className="rounded-2xl border border-dashed px-4 py-4 text-sm text-muted-foreground">{children}</p>
)

export function AppPage() {
  const t = useI18n().t.app
  const { locale } = useI18n()
  const id = useParams().app ?? ""
  const queryClient = useQueryClient()
  const me = authClient.useSession().data?.user.id
  const key = ["admin-app", id]
  const detail = useQuery({ queryKey: key, queryFn: () => api<AppDetail>(`/api/admin/apps/${encodeURIComponent(id)}`) })
  const [email, setEmail] = useState("")
  const date = (value: string) => new Date(value).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key })
    void queryClient.invalidateQueries({ queryKey: ["admin-apps"] })
  }
  const base = `/api/admin/apps/${encodeURIComponent(id)}`
  const invite = useMutation({
    mutationFn: (address: string) => api(`${base}/invites`, { method: "POST", json: { email: address } }),
    onSuccess: (_data, address) => {
      toast.success(t.invited(address))
      setEmail("")
      refresh()
    },
    onError: (error) => toast.error(errorText(error)),
  })
  const act = useMutation({
    mutationFn: ({ path, method }: { path: string; method: "POST" | "DELETE"; done?: string }) =>
      api(`${base}${path}`, { method }),
    onSuccess: (_data, { done }) => {
      if (done) toast.success(done)
      refresh()
    },
    onError: (error) => toast.error(errorText(error)),
  })

  if (detail.isError) return <p className="text-sm text-destructive">{t.loadFailed}</p>
  if (!detail.data) return null
  const { app, members, invites, requests } = detail.data

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          to="/apps"
          className="-ml-1 flex w-fit items-center gap-1 rounded-lg px-1 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} aria-hidden="true" className="size-4" />
          {t.back}
        </Link>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{app.name}</h1>
          <Button asChild variant="ghost" size="sm">
            <a href={app.url} target="_blank" rel="noopener">
              {t.open}
              <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>

      <Section title={t.invite}>
        <form
          className="flex flex-col gap-2 rounded-2xl border p-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (email.trim()) invite.mutate(email.trim())
          }}
        >
          <div className="flex gap-2">
            <Input
              type="email"
              required
              autoComplete="off"
              aria-label={t.email}
              placeholder={t.email}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={invite.isPending || !email.trim()}>
              {t.send}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t.inviteHelp}</p>
        </form>
      </Section>

      {requests.length > 0 && (
        <Section title={t.requests} count={requests.length}>
          <List>
            {requests.map((request) => (
              <Row key={request.id}>
                <PersonLine person={request.user} detail={date(request.createdAt)} />
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ path: `/requests/${request.id}`, method: "DELETE" })}
                  >
                    {t.decline}
                  </Button>
                  <Button
                    size="sm"
                    disabled={act.isPending}
                    onClick={() =>
                      act.mutate({
                        path: `/requests/${request.id}/approve`,
                        method: "POST",
                        done: t.approved(request.user.name || request.user.email),
                      })
                    }
                  >
                    {t.approve}
                  </Button>
                </div>
              </Row>
            ))}
          </List>
        </Section>
      )}

      <Section title={t.pending} count={invites.length}>
        {invites.length === 0 ? (
          <Quiet>{t.pendingEmpty}</Quiet>
        ) : (
          <List>
            {invites.map((item) => (
              <Row key={item.id}>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{item.email}</span>
                  <span className="text-xs text-muted-foreground">{date(item.createdAt)}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hover:bg-transparent! hover:text-destructive! dark:hover:bg-transparent!"
                  aria-label={t.cancelInvite(item.email)}
                  title={t.cancelInvite(item.email)}
                  disabled={act.isPending}
                  onClick={() => act.mutate({ path: `/invites/${item.id}`, method: "DELETE" })}
                >
                  <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden="true" />
                </Button>
              </Row>
            ))}
          </List>
        )}
      </Section>

      <Section title={t.members} count={members.length}>
        {members.length === 0 ? (
          <Quiet>{t.membersEmpty}</Quiet>
        ) : (
          <List>
            {members.map((member) => (
              <Row key={member.id}>
                <PersonLine
                  person={member}
                  detail={member.id === me ? t.you : t.since(date(member.grantedAt))}
                />
                {member.id !== me && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-muted-foreground hover:bg-transparent! hover:text-destructive! dark:hover:bg-transparent!"
                      >
                        {t.remove}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t.removeTitle(member.name || member.email)}</AlertDialogTitle>
                        <AlertDialogDescription>{t.removeBody}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t.removeCancel}</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => act.mutate({ path: `/members/${member.id}`, method: "DELETE" })}
                        >
                          {t.removeConfirm}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </Row>
            ))}
          </List>
        )}
      </Section>
    </div>
  )
}
