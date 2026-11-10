import { useState } from "react"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from "react-router"
import { Shield02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { AuthForm } from "@evido/ui/components/auth-form"
import { Button } from "@evido/ui/components/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@evido/ui/components/empty"
import { Toaster } from "@evido/ui/components/sonner"
import { ThemeProvider } from "@evido/ui/lib/theme"
import { I18nProvider, useI18n } from "@/i18n"
import { api } from "@/lib/api"
import { authClient, signOut } from "@/lib/auth-client"
import { AppPage } from "@/pages/app"
import { AppsPage } from "@/pages/apps"

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

function Login() {
  const { t } = useI18n()
  return (
    <div className="auth-layout">
      <header>
        <Brand />
      </header>
      <main className="auth-main">
        <AuthForm mode="login" client={authClient} texts={{ ...t.auth, noConnection: t.shell.noConnection }} />
      </main>
      <footer>{t.auth.layout.tagline}</footer>
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
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Link to="/" className="rounded-lg focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none">
          <Brand />
        </Link>
        <div className="flex min-w-0 items-center gap-3 text-sm text-muted-foreground">
          <span className="truncate max-sm:hidden">{session.data.user.email}</span>
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            {t.signOut}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <Outlet />
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
              <Route path="login" element={<Login />} />
              <Route element={<Shell />}>
                <Route index element={<AppsPage />} />
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
