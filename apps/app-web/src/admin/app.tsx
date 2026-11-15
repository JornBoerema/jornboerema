import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes } from "react-router"
import {
  Analytics01Icon,
  CodeIcon,
  DashboardSquare01Icon,
  Logout03Icon,
  Shield02Icon,
  UserGroupIcon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { goToSignIn } from "@even/auth/client"
import { hideSplash } from "@even/shell/splash"
import { Avatar, AvatarFallback, AvatarImage } from "@even/ui/components/avatar"
import { Button } from "@even/ui/components/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@even/ui/components/empty"
import { Toaster } from "@even/ui/components/sonner"
import { ThemeProvider } from "@even/ui/lib/theme"
import { cn } from "@even/ui/lib/utils"
import { I18nProvider, useI18n } from "@/admin/i18n"
import { api } from "@/admin/lib/api"
import { authClient, signOut } from "@/admin/lib/auth-client"
import { AppPage } from "@/admin/pages/app"
import { AppsPage, type AppSummary } from "@/admin/pages/apps"
import { BuildsPage } from "@/admin/pages/builds"
import { OverviewPage } from "@/admin/pages/overview"
import { UserPage } from "@/admin/pages/user"
import { UsersPage } from "@/admin/pages/users"
import { VisitorsPage } from "@/admin/pages/visitors"
import "./admin.css"

function Brand() {
  const t = useI18n().t.shell
  return (
    <div className="brand">
      <HugeiconsIcon icon={Shield02Icon} strokeWidth={2.5} aria-hidden="true" className="size-5" />
      <span>
        {t.brand}
        <span className="text-primary">.</span>
      </span>
    </div>
  )
}

/** Signed in as an admin; anyone else sees why not. The API checks again on every call. */
function Shell() {
  const t = useI18n().t.shell
  const session = authClient.useSession()
  const me = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => api<{ admin: boolean }>("/api/admin/me"),
    enabled: Boolean(session.data),
    retry: false,
  })
  const signedOut = !session.isPending && !session.data
  useEffect(() => {
    if (signedOut) goToSignIn({ returnTo: window.location.href })
  }, [signedOut])
  if (session.isPending || !session.data) return null
  if (me.isPending) return null
  if (!me.data?.admin)
    return (
      <div className="auth-layout">
        <header>
          <Brand />
        </header>
        <main className="auth-main">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Shield02Icon} strokeWidth={1.75} />
              </EmptyMedia>
              <EmptyTitle>{t.notAdminTitle}</EmptyTitle>
              <EmptyDescription>{t.notAdminBody(session.data.user.email)}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={() => void signOut()}>
                {t.otherAccount}
              </Button>
            </EmptyContent>
          </Empty>
        </main>
      </div>
    )
  return <Layout email={session.data.user.email} name={session.data.user.name} image={session.data.user.image ?? null} />
}

function Layout({ email, name, image }: { email: string; name: string; image: string | null }) {
  const { t } = useI18n()
  const apps = useQuery({ queryKey: ["admin-apps"], queryFn: () => api<{ apps: AppSummary[] }>("/api/admin/apps") })
  const requests = apps.data?.apps.reduce((sum, app) => sum + app.requests, 0) ?? 0
  const link = ({ isActive }: { isActive: boolean }) => cn("list-link", isActive && "is-selected")
  return (
    <div className="admin-shell">
      <aside className="list-sidebar admin-sidebar" aria-label={t.nav.label}>
        <div className="sidebar-brand-row">
          <Link to="/" className="rounded-lg focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none">
            <Brand />
          </Link>
        </div>
        <nav className="list-navigation admin-nav" aria-label={t.nav.label}>
          <NavLink to="/" end className={link}>
            <HugeiconsIcon icon={DashboardSquare01Icon} strokeWidth={2} aria-hidden="true" className="size-4 shrink-0" />
            <span>{t.nav.overview}</span>
          </NavLink>
          <NavLink to="/visitors" className={link}>
            <HugeiconsIcon icon={Analytics01Icon} strokeWidth={2} aria-hidden="true" className="size-4 shrink-0" />
            <span>{t.nav.visitors}</span>
          </NavLink>
          <NavLink to="/users" className={link}>
            <HugeiconsIcon icon={UserMultiple02Icon} strokeWidth={2} aria-hidden="true" className="size-4 shrink-0" />
            <span>{t.nav.users}</span>
          </NavLink>
          <NavLink to="/apps" className={link}>
            <HugeiconsIcon icon={UserGroupIcon} strokeWidth={2} aria-hidden="true" className="size-4 shrink-0" />
            <span>{t.nav.apps}</span>
            {requests > 0 && (
              <span className="admin-nav-badge" aria-label={t.apps.requests(requests)}>
                {requests}
              </span>
            )}
          </NavLink>
          <NavLink to="/builds" className={link}>
            <HugeiconsIcon icon={CodeIcon} strokeWidth={2} aria-hidden="true" className="size-4 shrink-0" />
            <span>{t.nav.builds}</span>
          </NavLink>
        </nav>
        <div className="sidebar-footer admin-account">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar className="size-7">
              {image && <AvatarImage src={image} alt="" />}
              <AvatarFallback className="text-[11px]">{(name || email).slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col leading-tight max-md:hidden">
              <span className="truncate text-[13px] font-medium">{name || email}</span>
              <span className="truncate text-xs text-muted-foreground">{email}</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.shell.signOut}
            title={t.shell.signOut}
            onClick={() => void signOut()}
          >
            <HugeiconsIcon icon={Logout03Icon} strokeWidth={2} aria-hidden="true" />
          </Button>
        </div>
      </aside>
      <main className="admin-main">
        <div className="admin-content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

/** app.jornboerema.nl/admin: statistics, people, who may use which app, and builds. */
export function AdminApp() {
  // The web app's page doesn't scroll (the apps scroll inside); the admin does, on phones.
  useEffect(() => {
    hideSplash()
    document.body.classList.remove("overflow-hidden")
    document.title = "Admin · Even"
  }, [])
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } }))
  return (
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={client}>
          <BrowserRouter basename="/admin">
            <Routes>
              <Route element={<Shell />}>
                <Route index element={<OverviewPage />} />
                <Route path="visitors" element={<VisitorsPage />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="users/:id" element={<UserPage />} />
                <Route path="apps" element={<AppsPage />} />
                <Route path="apps/:app" element={<AppPage />} />
                <Route path="builds" element={<BuildsPage />} />
              </Route>
              <Route path="*" element={<Navigate replace to="/" />} />
            </Routes>
          </BrowserRouter>
          <Toaster position="bottom-right" closeButton />
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
