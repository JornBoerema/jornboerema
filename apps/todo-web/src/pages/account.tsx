import { Navigate } from "react-router"

/** Old /account links now open the settings dialog. */
export function AccountPage() {
  return <Navigate replace to="/?instellingen=account" />
}
