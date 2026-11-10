import { useEffect, useRef, useState, type RefObject } from "react"
import { currentLanguage } from "@evido/i18n/react"
import { parseWritten } from "@evido/mail-core/write"
import { toast } from "sonner"
import { ArrowUp02Icon, SparklesIcon, StopIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { cn } from "@evido/ui/lib/utils"
import type { RichTextHandle } from "@/components/rich-text-editor"
import { useI18n } from "@/i18n"
import { API_URL, ApiError, errorText } from "@/lib/api"
import { textToEditorHtml } from "@/lib/email-compose"
import { useAiWriting } from "@/lib/preferences"

/**
 * Has a language model write the message, or rewrite what is there, from one
 * short line. The text appears as the model writes it, so it reads like typing
 * without waiting any longer than the model takes. The result is a single undo
 * step.
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
  const [pending, setPending] = useState(false)
  const running = useRef<AbortController | null>(null)

  // Leaving the composer stops the model; what it wrote so far stays.
  useEffect(() => () => running.current?.abort(), [])

  async function write(text: string) {
    const controller = new AbortController()
    running.current = controller
    setPending(true)
    const previousSubject = subject ?? ""
    const fillsSubject = Boolean(onSubject) && !previousSubject.trim()
    let written = ""
    let shownSubject: string | null = null
    let frame = 0
    const show = () => {
      frame = 0
      const { subject: streamedSubject, text: body } = parseWritten(written, { done: false })
      editor.current?.streamBody(textToEditorHtml(body))
      if (fillsSubject && streamedSubject && streamedSubject !== shownSubject) {
        shownSubject = streamedSubject
        onSubject?.(streamedSubject)
      }
    }
    try {
      const headers = new Headers({ "Content-Type": "application/json", "Accept-Language": currentLanguage() })
      const response = await fetch(`${API_URL}${url}`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          instruction: text,
          draft: editor.current?.bodyText() ?? "",
          subject: previousSubject,
          hasSignature,
          forward,
        }),
      })
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new ApiError(body?.error ?? response.statusText, response.status)
      }
      editor.current?.startStream()
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        written += value
        // At most once a frame, however fast the words come in.
        if (!frame) frame = requestAnimationFrame(show)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        cancelAnimationFrame(frame)
        editor.current?.cancelStream()
        if (shownSubject) onSubject?.(previousSubject)
        toast.error(errorText(error))
        setPending(false)
        running.current = null
        return
      }
    }
    cancelAnimationFrame(frame)
    running.current = null
    setPending(false)
    const result = parseWritten(written)
    if (!result.text) {
      editor.current?.cancelStream()
      if (shownSubject) onSubject?.(previousSubject)
      if (!controller.signal.aborted) toast.error(t.aiEmpty)
      return
    }
    editor.current?.finishStream(textToEditorHtml(result.text))
    const newSubject = fillsSubject && result.subject ? result.subject : null
    if (newSubject) onSubject?.(newSubject)
    setOpen(false)
    setInstruction("")
    toast(t.aiWritten, {
      id: "ai-written",
      action: {
        label: t.aiUndo,
        onClick: () => {
          editor.current?.undo()
          if (newSubject) onSubject?.(previousSubject)
        },
      },
    })
  }

  return {
    enabled,
    open,
    instruction,
    setInstruction,
    /** Something is written already, so the instruction says what to change. */
    editing,
    pending,
    toggle: () => {
      if (pending) return
      if (open) return setOpen(false)
      setEditing(Boolean(editor.current?.bodyText()))
      setOpen(true)
    },
    /** While writing, stops and keeps what is there. */
    close: () => {
      running.current?.abort()
      setOpen(false)
      editor.current?.focus()
    },
    submit: () => {
      if (instruction.trim() && !pending) void write(instruction.trim())
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
  const input = useRef<HTMLInputElement>(null)
  const { open } = writer
  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true })
  }, [open])
  if (!writer.enabled) return null
  return (
    // Unfolds by growing its row from nothing, and folds back the same way.
    <div
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div className={cn("flex items-center gap-2", className)}>
          <HugeiconsIcon
            icon={SparklesIcon}
            strokeWidth={1.75}
            aria-hidden="true"
            className="size-4 shrink-0 text-primary"
          />
          <input
            ref={input}
            aria-label={t.aiWrite}
            value={writer.instruction}
            readOnly={writer.pending}
            placeholder={writer.editing ? t.aiPlaceholderEdit : t.aiPlaceholderNew}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground read-only:opacity-60"
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
          {writer.pending && (
            <span role="status" className="shrink-0 text-xs text-muted-foreground">
              {t.aiWriting}
            </span>
          )}
          {/* One round control: write, or stop while writing. Closing is the sparkle button or Escape. */}
          <button
            type="button"
            aria-label={writer.pending ? t.aiStop : t.aiSubmit}
            title={writer.pending ? t.aiStop : t.aiSubmit}
            disabled={!writer.pending && !writer.instruction.trim()}
            onClick={writer.pending ? writer.close : writer.submit}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
              writer.pending || writer.instruction.trim()
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground"
            )}
          >
            <HugeiconsIcon
              icon={writer.pending ? StopIcon : ArrowUp02Icon}
              strokeWidth={2.25}
              aria-hidden="true"
              className={writer.pending ? "size-3.5 fill-current" : "size-4"}
            />
          </button>
        </div>
      </div>
    </div>
  )
}
