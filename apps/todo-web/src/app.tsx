import { BrowserRouter, Navigate, Route, Routes } from "react-router"
import { Providers } from "./providers"
import { HomePage } from "./pages/home"
import { ToAccountSite } from "@evido/ui/components/account-site"
import { AuthLayout } from "./pages/auth-layout"
import { InvitationPage } from "./pages/invitation"
import { SharedListPage } from "./pages/shared-list"

export function App() {
  return (
    <Providers>
      <BrowserRouter>
        <Routes>
          <Route index element={<HomePage />} />
          <Route path="shared/:token" element={<SharedListPage />} />
          {/* Signing in happens on the account site (auth.jornboerema.nl). */}
          <Route path="login" element={<ToAccountSite path="/login" />} />
          <Route path="signup" element={<ToAccountSite path="/signup" />} />
          <Route path="forgot-password" element={<ToAccountSite path="/forgot-password" />} />
          <Route path="reset-password" element={<ToAccountSite path="/reset-password" />} />
          <Route path="connect" element={<ToAccountSite path="/connect" keepQuery />} />
          <Route element={<AuthLayout />}>
            <Route path="invite/:token" element={<InvitationPage />} />
          </Route>
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </BrowserRouter>
    </Providers>
  )
}
