import { Link, Outlet } from "react-router"
import { Brand } from "@/components/brand"
import { useI18n } from "@/i18n"

export function AuthLayout() {
  const t = useI18n().t.auth.layout
  return (
    <div className="auth-layout">
      <header>
        <Link to="/" aria-label={t.homeLabel}>
          <Brand />
        </Link>
      </header>
      <main className="auth-main">
        <Outlet />
      </main>
      <footer>{t.tagline}</footer>
    </div>
  )
}
