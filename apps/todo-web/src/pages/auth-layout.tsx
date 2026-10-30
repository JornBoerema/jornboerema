import { Link, Outlet } from "react-router"
import { Brand } from "@/components/brand"

export function AuthLayout() {
  return (
    <div className="auth-layout">
      <header>
        <Link to="/inloggen" aria-label="Even doen, naar inloggen">
          <Brand />
        </Link>
      </header>
      <main className="auth-main">
        <Outlet />
      </main>
      <footer>Je eigen lijsten. Een taak tegelijk.</footer>
    </div>
  )
}
