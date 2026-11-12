import { Link, Outlet } from "react-router"
import { Brand } from "@/components/brand"
import { useI18n } from "@/i18n"

/** The sign-in pages: the brand, one centred form and the tagline. */
export function AuthLayout() {
  const t = useI18n().t.layout
  return (
    <div className="auth-layout">
      <header>
        <Link to="/" aria-label={t.homeLabel} className="inline-block">
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
