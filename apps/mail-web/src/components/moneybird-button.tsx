import { useMemo, useState } from "react"
import { toast } from "sonner"
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { ButtonGroup, ButtonGroupSeparator } from "@evido/ui/components/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu"
import { Spinner } from "@evido/ui/components/spinner"
import { attachmentKey, bookableFiles, likeliestInvoiceFile, type MoneybirdAdministration } from "@evido/mail-core/connections"
import type { MailThreadMessage } from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { errorText } from "@/lib/api"
import { useMoneybird, useMoneybirdThread, useSendToMoneybird, type MoneybirdFile } from "@/lib/connections"
import { IconTip } from "@/components/icon-tip"

/** No focus ring on this pair: it shows each time the menu hands focus back. */
const NO_RING = "focus-visible:border-transparent focus-visible:ring-0"
const ITEM = "min-h-7 gap-2.5 rounded-lg px-2 py-1 text-[13px]"

/** PDFs and receipts in the conversation, newest message first. */
function filesIn(messages: MailThreadMessage[]): MoneybirdFile[] {
  const all = [...messages]
    .reverse()
    .flatMap((message) =>
      message.attachments.map((file) => ({ messageId: message.id, attachmentId: file.id, name: file.name, contentType: file.contentType, size: file.size }))
    )
  return bookableFiles(all)
}

/**
 * On the invoice card: puts the invoice's PDF in Moneybird's inbox in one
 * click, to the administration this sender's mail went to before, or the
 * default one. The arrow picks another file or administration.
 */
export function MoneybirdButton({ threadId, messages, subject }: { threadId: string; messages: MailThreadMessage[]; subject: string }) {
  const t = useI18n().t.connections
  const moneybird = useMoneybird()
  const files = useMemo(() => filesIn(messages), [messages])
  const { data } = useMoneybirdThread(threadId, !!moneybird && files.length > 0)
  const send = useSendToMoneybird(threadId)
  const [chosenKey, setChosenKey] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  if (!moneybird || files.length === 0) return null

  const file = files.find((item) => attachmentKey(item) === chosenKey) ?? likeliestInvoiceFile(files)!
  const administrations = moneybird.administrations
  const known = (id: string | null | undefined) => administrations.find((item) => item.id === id) ?? null
  const target =
    known(data?.suggestedAdministrationId) ?? known(moneybird.defaultTarget?.id) ?? (administrations.length === 1 ? administrations[0] : null)
  const sent = data?.exports.find((item) => item.attachmentKey === attachmentKey(file))

  const sendTo = (administration: MoneybirdAdministration) =>
    send.mutate(
      { ...file, administrationId: administration.id, subject },
      {
        onSuccess: ({ export: done }) =>
          toast.success(t.sent(done.administrationName), {
            action: { label: t.open, onClick: () => window.open(done.url, "_blank", "noopener,noreferrer") },
          }),
        onError: (error) => toast.error(errorText(error)),
      }
    )

  const menu = files.length > 1 || administrations.length > 1
  const main = sent ? (
    <IconTip label={t.sentTo(sent.administrationName)}>
      <Button size="sm" variant="outline" className={NO_RING} asChild>
        <a href={sent.url} target="_blank" rel="noopener noreferrer">
          <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} data-icon="inline-start" aria-hidden="true" />
          {t.inMoneybird}
        </a>
      </Button>
    </IconTip>
  ) : (
    <IconTip label={target ? t.sendTo(file.name, target.name) : t.chooseAdministration}>
      <Button
        size="sm"
        variant="outline"
        className={NO_RING}
        disabled={send.isPending}
        onClick={() => (target ? sendTo(target) : setMenuOpen(true))}
      >
        {send.isPending && <Spinner data-icon="inline-start" />}
        {t.toMoneybird}
      </Button>
    </IconTip>
  )
  if (!menu && (sent || target)) return main

  return (
    <ButtonGroup>
      {main}
      <ButtonGroupSeparator />
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="outline" className={NO_RING} disabled={send.isPending} aria-label={t.moreOptions}>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              strokeWidth={2}
              aria-hidden="true"
              className="transition-transform duration-200 ease-out group-aria-expanded/button:rotate-180 motion-reduce:transition-none"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="max-w-72 min-w-52 p-1">
          {files.length > 1 && (
            <>
              <DropdownMenuLabel className="px-2 text-xs text-muted-foreground">{t.file}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={attachmentKey(file)} onValueChange={setChosenKey}>
                {files.map((item) => (
                  <DropdownMenuRadioItem
                    key={`${item.messageId}:${attachmentKey(item)}`}
                    value={attachmentKey(item)}
                    className={ITEM}
                    // Picking a file keeps the menu open, to pick where it goes next.
                    onSelect={(event) => event.preventDefault()}
                  >
                    <span className="truncate">{item.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuLabel className="px-2 text-xs text-muted-foreground">{t.sendToLabel}</DropdownMenuLabel>
          {administrations.map((administration) => (
            <DropdownMenuItem key={administration.id} className={ITEM} onSelect={() => sendTo(administration)}>
              <span className="truncate">{administration.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}
