import { BrowserRouter, Navigate, Route, Routes } from "react-router"
import { Providers } from "./providers"
import { HomePage } from "./pages/home"
import { AuthLayout } from "./pages/auth-layout"
import { AuthPage } from "./pages/auth"
import { ConsentPage } from "./pages/consent"
import { InvitationPage } from "./pages/invitation"
import { SharedListPage } from "./pages/shared-list"

export function App() {
  return (
    <Providers>
      <BrowserRouter>
        <Routes>
          <Route index element={<HomePage />} />
          <Route path="shared/:token" element={<SharedListPage />} />
          <Route element={<AuthLayout />}>
            <Route path="login" element={<AuthPage mode="login" />} />
            <Route path="signup" element={<AuthPage mode="register" />} />
            <Route
              path="forgot-password"
              element={<AuthPage mode="forgot" />}
            />
            <Route path="reset-password" element={<AuthPage mode="reset" />} />
            <Route path="invite/:token" element={<InvitationPage />} />
            <Route path="connect" element={<ConsentPage />} />
          </Route>
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </BrowserRouter>
    </Providers>
  )
}
