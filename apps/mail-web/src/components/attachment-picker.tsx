import { useEffect, useRef, type Dispatch, type SetStateAction } from "react"
import { toast } from "sonner"
import { Alert02Icon, Attachment01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { cn } from "@evido/ui/lib/utils"
import { MAX_ATTACHMENTS_BYTES } from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { errorText } from "@/lib/api"
import { deleteUpload, uploadFile, type ComposerFile } from "@/lib/uploads"
import { IconTip } from "@/components/icon-tip"

const LIMIT_LABEL = `${MAX_ATTACHMENTS_BYTES / (1024 * 1024)} MB`

/**
 * Picks files and uploads each one in chunks straight away, with its progress
 * on the chip. The composer sends only the finished ones, by id.
 */
export function AttachmentPicker({
  files,
  onChange,
}: {
  files: ComposerFile[]
  onChange: Dispatch<SetStateAction<ComposerFile[]>>
}) {
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

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
      <IconTip label={`${t.attach} (max ${LIMIT_LABEL})`}>
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
              add(Array.from(event.target.files ?? []))
              event.target.value = ""
            }}
          />
        </label>
      </Button>
      </IconTip>
      {files.map((file) => {
        const uploading = !file.failed && file.progress < 1
        return (
          <span
            key={file.key}
            className={cn(
              "relative flex max-w-48 items-center gap-1 overflow-hidden rounded-md border py-0.5 pr-0.5 pl-2 text-muted-foreground",
              file.failed && "border-destructive/50 text-destructive"
            )}
            title={file.failed ? t.uploadFailed(file.name) : uploading ? t.uploading(file.name) : file.name}
          >
            {uploading && (
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 bg-muted transition-[width] duration-300"
                style={{ width: `${Math.max(4, file.progress * 100)}%` }}
              />
            )}
            {file.failed && (
              <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="relative size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="relative truncate">{file.name}</span>
            {uploading && (
              <span className="relative shrink-0 tabular-nums" role="status">
                {Math.round(file.progress * 100)}%
              </span>
            )}
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="relative"
              aria-label={t.removeFile(file.name)}
              onClick={() => remove(file)}
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden="true" />
            </Button>
          </span>
        )
      })}
    </div>
  )
}
