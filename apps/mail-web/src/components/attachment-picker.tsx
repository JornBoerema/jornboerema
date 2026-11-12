import { useEffect, useRef, type Dispatch, type SetStateAction } from "react"
import { toast } from "sonner"
import {
  Alert02Icon,
  Attachment01Icon,
  Cancel01Icon,
  Doc02Icon,
  File02Icon,
  Image02Icon,
  MusicNote02Icon,
  Pdf02Icon,
  Video02Icon,
  Xls02Icon,
  Zip02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { cn } from "@evido/ui/lib/utils"
import { MAX_ATTACHMENTS_BYTES } from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { errorText } from "@/lib/api"
import { deleteUpload, uploadFile, type ComposerFile } from "@/lib/uploads"

const LIMIT_LABEL = `${MAX_ATTACHMENTS_BYTES / (1024 * 1024)} MB`

/**
 * Uploads picked files in chunks straight away. The composer sends only the
 * finished ones, by id; removing one stops its upload.
 */
export function useAttachments(
  files: ComposerFile[],
  onChange: Dispatch<SetStateAction<ComposerFile[]>>
) {
  const t = useI18n().t.compose
  const running = useRef(new Map<string, AbortController>())

  // Leaving the composer stops what is still uploading; the server drops the rest later.
  useEffect(() => {
    const uploads = running.current
    return () => uploads.forEach((controller) => controller.abort())
  }, [])

  const update = (key: string, change: Partial<ComposerFile>) =>
    onChange((current) => current.map((file) => (file.key === key ? { ...file, ...change } : file)))

  async function start(file: File, key: string) {
    const controller = new AbortController()
    running.current.set(key, controller)
    try {
      await uploadFile(file, {
        signal: controller.signal,
        onStart: (uploadId) => update(key, { uploadId }),
        onProgress: (progress) => update(key, { progress }),
      })
    } catch (error) {
      if (controller.signal.aborted) return
      update(key, { failed: true })
      toast.error(errorText(error))
    } finally {
      running.current.delete(key)
    }
  }

  function add(selected: File[]) {
    const current = files.filter((file) => !file.failed).reduce((sum, file) => sum + file.size, 0)
    const adding = selected.reduce((sum, file) => sum + file.size, 0)
    if (current + adding > MAX_ATTACHMENTS_BYTES) {
      toast.error(t.tooLarge(LIMIT_LABEL))
      return
    }
    const added = selected.map((file) => ({
      file,
      entry: {
        key: crypto.randomUUID(),
        name: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        uploadId: null,
        progress: 0,
        failed: false,
      } satisfies ComposerFile,
    }))
    onChange((list) => [...list, ...added.map((item) => item.entry)])
    for (const item of added) void start(item.file, item.entry.key)
  }

  function remove(file: ComposerFile) {
    running.current.get(file.key)?.abort()
    if (file.uploadId) void deleteUpload(file.uploadId)
    onChange((list) => list.filter((item) => item.key !== file.key))
  }

  return { add, remove }
}

const KB = 1024
const MB = KB * 1024
const sizeLabel = (bytes: number, locale: string) =>
  bytes >= MB
    ? `${(bytes / MB).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / KB)).toLocaleString(locale)} KB`

function iconFor(file: ComposerFile): IconSvgElement {
  const type = file.contentType
  const name = file.name.toLowerCase()
  if (type === "application/pdf" || name.endsWith(".pdf")) return Pdf02Icon
  if (type.startsWith("image/")) return Image02Icon
  if (type.startsWith("video/")) return Video02Icon
  if (type.startsWith("audio/")) return MusicNote02Icon
  if (/\.(zip|rar|7z|gz|tar)$/.test(name)) return Zip02Icon
  if (/\.(xlsx?|csv|numbers)$/.test(name)) return Xls02Icon
  if (/\.(docx?|pages|rtf|odt)$/.test(name)) return Doc02Icon
  return File02Icon
}

/** The paperclip: picks files, up to the limit together. */
export function AttachButton({ onAdd }: { onAdd: (files: File[]) => void }) {
  const t = useI18n().t.compose
  return (
    <Button
      asChild
      variant="ghost"
      size="icon-sm"
      className="has-focus-visible:ring-3 has-focus-visible:ring-ring/30"
    >
      <label>
        <HugeiconsIcon icon={Attachment01Icon} strokeWidth={1.75} aria-hidden="true" />
        <span className="sr-only">
          {t.attach} (max {LIMIT_LABEL})
        </span>
        <input
          type="file"
          multiple
          className="sr-only"
          onChange={(event) => {
            onAdd(Array.from(event.target.files ?? []))
            event.target.value = ""
          }}
        />
      </label>
    </Button>
  )
}

/** The attached files as small cards: kind, name, size, and how far the upload is. */
export function AttachmentList({
  files,
  onRemove,
  className,
}: {
  files: ComposerFile[]
  onRemove: (file: ComposerFile) => void
  className?: string
}) {
  const { t: strings, locale } = useI18n()
  const t = strings.compose
  const open = files.length > 0
  // The last files stay in view while the row folds away, so it doesn't jump.
  const shown = useRef(files)
  if (open) shown.current = files
  const list = open ? files : shown.current
  return (
    // Unfolds like the AI prompt: the row grows from nothing, and folds back once empty.
    <div
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <ul aria-label={t.attachments} className={cn("flex flex-wrap gap-2", className)}>
          {list.map((file) => {
            const uploading = !file.failed && file.progress < 1
            return (
              <li
                key={file.key}
                className={cn(
                  "group relative flex h-11 max-w-60 min-w-0 items-center gap-2.5 overflow-hidden rounded-lg border bg-muted/40 pr-1.5 pl-2 duration-200 animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none",
                  file.failed && "border-destructive/40"
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground",
                    file.failed && "text-destructive"
                  )}
                >
                  <HugeiconsIcon icon={file.failed ? Alert02Icon : iconFor(file)} strokeWidth={1.75} aria-hidden="true" className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-xs font-medium">{file.name}</span>
                  <span
                    role={uploading ? "status" : undefined}
                    className={cn("truncate text-[11px] tabular-nums text-muted-foreground", file.failed && "text-destructive")}
                  >
                    {file.failed
                      ? t.uploadFailedShort
                      : uploading
                        ? `${sizeLabel(file.size, locale)} · ${Math.round(file.progress * 100)}%`
                        : sizeLabel(file.size, locale)}
                  </span>
                </span>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  className="shrink-0 text-foreground/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-transparent! hover:text-foreground [@media(hover:none)]:opacity-100"
                  aria-label={t.removeFile(file.name)}
                  onClick={() => onRemove(file)}
                >
                  <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden="true" />
                </Button>
                {uploading && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary transition-transform duration-300"
                    style={{ transform: `scaleX(${Math.max(0.04, file.progress)})` }}
                  />
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
