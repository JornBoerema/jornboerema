import { goToSignIn } from "@even/auth/client"
import { authClient } from "@/account/lib/auth-client"

export { authClient }

/** Signs out and comes back here after signing in again. */
export async function signOut() {
  await authClient.signOut()
  goToSignIn({ returnTo: `${window.location.origin}/admin` })
}
