import { useState } from "react"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes } from "react-router"
import { DashboardSquare01Icon, Logout03Icon, Shield02Icon, UserGroupIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { ToAccountSite } from "@evido/ui/components/account-site"
import { Avatar, AvatarFallback, AvatarImage } from "@evido/ui/components/avatar"
import { Button } from "@evido/ui/components/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@evido/ui/components/empty"
import { Toaster } from "@evido/ui/components/sonner"
import { ThemeProvider } from "@evido/ui/lib/theme"
import { cn } from "@evido/ui/lib/utils"
import { I18nProvider, useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { authClient, signOut } from "@/lib/auth-client"
import { AppPage } from "@/pages/app"
import { AppsPage, type AppSummary } from "@/pages/apps"
import { DashboardPage } from "@/pages/dashboard"

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
  if (session.isPending) return null
  if (!session.data) return <Navigate replace to="/login" />
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
            <span>{t.nav.dashboard}</span>
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

export function App() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } }))
  return (
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={client}>
          <BrowserRouter basename="/admin">
            <Routes>
              {/* Signing in happens on the account site (auth.jornboerema.nl). */}
              <Route path="login" element={<ToAccountSite path="/login" home="/admin/" />} />
              <Route element={<Shell />}>
                <Route index element={<DashboardPage />} />
                <Route path="apps" element={<AppsPage />} />
                <Route path="apps/:app" element={<AppPage />} />
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
