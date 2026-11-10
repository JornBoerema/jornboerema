import { useState, type RefObject } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Cancel01Icon, SparklesIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { Spinner } from "@evido/ui/components/spinner"
import { cn } from "@evido/ui/lib/utils"
import type { RichTextHandle } from "@/components/rich-text-editor"
import { useI18n } from "@/i18n"
import { api, errorText } from "@/lib/api"
import { textToEditorHtml } from "@/lib/email-compose"
import { useAiWriting } from "@/lib/preferences"

type Written = { subject: string | null; text: string }

/**
 * Has a language model write the message, or rewrite what is there, from one
 * short line. The result lands in the editor as a single undo step.
 */
export function useAiWriter({
  url,
  editor,
  hasSignature,
  subject,
  onSubject,
  forward = false,
}: {
  /** The API path; a reply's carries its conversation. */
  url: string
  editor: RefObject<RichTextHandle | null>
  hasSignature: boolean
  subject?: string
  onSubject?: (subject: string) => void
  /** A note on top of a forwarded conversation, not an answer to it. */
  forward?: boolean
}) {
  const t = useI18n().t.compose
  const enabled = useAiWriting()
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState("")
  const [editing, setEditing] = useState(false)
  const write = useMutation({
    mutationFn: (text: string) =>
      api<Written>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instruction: text,
          draft: editor.current?.bodyText() ?? "",
          subject: subject ?? "",
          hasSignature,
          forward,
        }),
      }),
    onSuccess: (result) => {
      const previousSubject = subject
      editor.current?.setBody(textToEditorHtml(result.text))
      const newSubject = result.subject && onSubject && !subject?.trim() ? result.subject : null
      if (newSubject) onSubject?.(newSubject)
      setOpen(false)
      setInstruction("")
      toast(t.aiWritten, {
        id: "ai-written",
        action: {
          label: t.aiUndo,
          onClick: () => {
            editor.current?.undo()
            if (newSubject) onSubject?.(previousSubject ?? "")
          },
        },
      })
    },
    onError: (error) => toast.error(errorText(error)),
  })
  return {
    enabled,
    open,
    instruction,
    setInstruction,
    /** Something is written already, so the instruction says what to change. */
    editing,
    pending: write.isPending,
    toggle: () => {
      if (open) return setOpen(false)
      setEditing(Boolean(editor.current?.bodyText()))
      setOpen(true)
    },
    close: () => {
      setOpen(false)
      editor.current?.focus()
    },
    submit: () => {
      if (instruction.trim() && !write.isPending) write.mutate(instruction.trim())
    },
  }
}

export type AiWriter = ReturnType<typeof useAiWriter>

export function AiWriteButton({ writer }: { writer: AiWriter }) {
  const t = useI18n().t.compose
  if (!writer.enabled) return null
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t.aiWrite}
      aria-expanded={writer.open}
      aria-keyshortcuts="Meta+J Control+J"
      title={`${t.aiWrite} (⌘J)`}
      className={cn(writer.open && "bg-accent text-foreground")}
      onClick={writer.toggle}
    >
      <HugeiconsIcon icon={SparklesIcon} strokeWidth={1.75} aria-hidden="true" />
    </Button>
  )
}

/** One line: what to write. Enter writes, Escape closes. */
export function AiPrompt({ writer, className }: { writer: AiWriter; className?: string }) {
  const t = useI18n().t.compose
  if (!writer.enabled || !writer.open) return null
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <HugeiconsIcon
        icon={SparklesIcon}
        strokeWidth={1.75}
        aria-hidden="true"
        className="size-4 shrink-0 text-primary"
      />
      <input
        autoFocus
        aria-label={t.aiWrite}
        value={writer.instruction}
        disabled={writer.pending}
        placeholder={writer.editing ? t.aiPlaceholderEdit : t.aiPlaceholderNew}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
        onChange={(event) => writer.setInstruction(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            // Not the composer's own Enter handling, which would send.
            event.preventDefault()
            event.stopPropagation()
            writer.submit()
          } else if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            writer.close()
          }
        }}
      />
      {writer.pending ? (
        <span role="status" className="flex shrink-0 items-center gap-1.5 px-2 text-xs text-muted-foreground">
          <Spinner />
          {t.aiWriting}
        </span>
      ) : (
        <Button type="button" size="sm" disabled={!writer.instruction.trim()} onClick={writer.submit}>
          {t.aiSubmit}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t.aiClose}
        title={t.aiClose}
        onClick={writer.close}
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden="true" />
      </Button>
    </div>
  )
}
