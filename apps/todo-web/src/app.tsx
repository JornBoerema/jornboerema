import { BrowserRouter, Navigate, Route, Routes } from "react-router"
import { Providers } from "./providers"
import { HomePage } from "./pages/home"
import { AccountPage } from "./pages/account"
import { AuthLayout } from "./pages/auth-layout"
import { AuthPage } from "./pages/auth"
import { ConsentPage } from "./pages/consent"
import { InvitationPage } from "./pages/invitation"
import { SharedListPage } from "./pages/shared-list"
import { DocsPage } from "./pages/docs"

export function App() {
  return (
    <Providers>
      <BrowserRouter>
        <Routes>
          <Route index element={<HomePage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="docs" element={<DocsPage />} />
          <Route path="gedeeld/:token" element={<SharedListPage />} />
          <Route element={<AuthLayout />}>
            <Route path="inloggen" element={<AuthPage mode="login" />} />
            <Route path="registreren" element={<AuthPage mode="register" />} />
            <Route path="wachtwoord-vergeten" element={<AuthPage mode="forgot" />} />
            <Route path="wachtwoord-herstellen" element={<AuthPage mode="reset" />} />
            <Route path="uitnodiging/:token" element={<InvitationPage />} />
            <Route path="koppelen" element={<ConsentPage />} />
          </Route>
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </BrowserRouter>
    </Providers>
  )
}
