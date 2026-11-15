import { useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import { useI18n } from "@/i18n"

/** Signs out and goes to the sign-in page; says so when it did not work, and throws. */
export function useSignOut() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const { t: { workspace: { switcher: t } } } = useI18n()
  return async () => {
    try {
      const result = await authClient.signOut()
      if (result.error) throw new Error()
    } catch (error) {
      toast.error(t.signOutFailed)
      throw error
    }
    client.clear()
    navigate("/login", { replace: true })
  }
}
