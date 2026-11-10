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
import { Delete04Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { Spinner } from "@evido/ui/components/spinner"
import { canDeleteForever, type MailAccountView } from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { api, errorText } from "@/lib/api"
import { MESSAGES_KEY } from "@/lib/mail"

/** Empties the trash for good, in the mailboxes that allow it. Gmail empties its own. */
export function EmptyTrashButton({
  accounts,
}: {
  accounts: MailAccountView[]
}) {
  const t = useI18n().t.conversation
  const queryClient = useQueryClient()
  const deletable = accounts.filter(
    (account) =>
      account.status === "active" && canDeleteForever(account.provider)
  )
  const empty = useMutation({
    mutationFn: async () => {
      let deleted = 0
      for (const account of deletable)
        // One page per call, so each stays well inside the function's time limit.
        for (let done = false; !done;) {
          const page = await api<{ deleted: number; done: boolean }>(
            `/api/mail/accounts/${account.id}/trash/empty`,
            {
              method: "POST",
            }
          )
          deleted += page.deleted
          done = page.done
        }
      return deleted
    },
    onSuccess: (deleted) => toast.success(t.emptiedTrash(deleted)),
    onError: (error) => toast.error(errorText(error)),
    onSettled: () =>
      void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY }),
  })
  if (deletable.length === 0) return null
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="hover:bg-transparent! hover:text-destructive! dark:hover:bg-transparent!"
          aria-label={t.emptyTrash}
          title={t.emptyTrash}
          disabled={empty.isPending}
        >
          {empty.isPending ? (
            <Spinner />
          ) : (
            <HugeiconsIcon
              icon={Delete04Icon}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.emptyTrashTitle}</AlertDialogTitle>
          <AlertDialogDescription>{t.emptyTrashBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.emptyTrashCancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => empty.mutate()}
          >
            {t.emptyTrashConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
