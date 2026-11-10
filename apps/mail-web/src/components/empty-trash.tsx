import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@evido/ui/components/alert-dialog"
import { Button } from "@evido/ui/components/button"
import { canDeleteForever, type MailAccountView } from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { api, errorText } from "@/lib/api"
import { MESSAGES_KEY } from "@/lib/mail"

/**
 * In the trash: empty it for good where the mailbox allows that, and say that
 * Gmail does it by itself, since this app may not.
 */
export function TrashNotice({ accounts }: { accounts: MailAccountView[] }) {
  const t = useI18n().t.conversation
  const queryClient = useQueryClient()
  const deletable = accounts.filter((account) => account.status === "active" && canDeleteForever(account.provider))
  const hasGmail = accounts.some((account) => account.provider === "gmail")
  const empty = useMutation({
    mutationFn: async () => {
      let deleted = 0
      for (const account of deletable)
        // One page per call, so each stays well inside the function's time limit.
        for (let done = false; !done; ) {
          const page = await api<{ deleted: number; done: boolean }>(`/api/mail/accounts/${account.id}/trash/empty`, {
            method: "POST",
          })
          deleted += page.deleted
          done = page.done
        }
      return deleted
    },
    onSuccess: (deleted) => toast.success(t.emptiedTrash(deleted)),
    onError: (error) => toast.error(errorText(error)),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY }),
  })
  if (deletable.length === 0 && !hasGmail) return null
  return (
    <div className="flex items-center justify-between gap-3 px-4 pb-2 text-xs text-muted-foreground">
      <span>{hasGmail ? t.gmailTrashNote : ""}</span>
      {deletable.length > 0 && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 shrink-0 hover:bg-transparent! hover:text-destructive! dark:hover:bg-transparent!"
              disabled={empty.isPending}
            >
              {t.emptyTrash}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.emptyTrashTitle}</AlertDialogTitle>
              <AlertDialogDescription>{t.emptyTrashBody}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t.emptyTrashCancel}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => empty.mutate()}>
                {t.emptyTrashConfirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}
