import { toast } from "sonner"
import { Button } from "@evido/ui/components/button"
import { MAX_UPLOAD_BYTES, type MailAttachmentUpload } from "@evido/mail-core/types"
import { useI18n } from "@/i18n"

const LIMIT_LABEL = `${MAX_UPLOAD_BYTES / (1024 * 1024)} MB`

function readAsBase64(file: File) {
  return new Promise<MailAttachmentUpload>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve({
        name: file.name,
        contentType: file.type || "application/octet-stream",
        data: (reader.result as string).split(",")[1] ?? "",
      })
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const decodedSize = (file: MailAttachmentUpload) => Math.floor(file.data.length * 0.75)

export function AttachmentPicker({
  files,
  onChange,
}: {
  files: MailAttachmentUpload[]
  onChange: (files: MailAttachmentUpload[]) => void
}) {
  const t = useI18n().t.compose

  async function add(selected: File[]) {
    const current = files.reduce((sum, file) => sum + decodedSize(file), 0)
    const adding = selected.reduce((sum, file) => sum + file.size, 0)
    if (current + adding > MAX_UPLOAD_BYTES) {
      toast.error(t.tooLarge(LIMIT_LABEL))
      return
    }
    try {
      onChange([...files, ...(await Promise.all(selected.map(readAsBase64)))])
    } catch {
      toast.error(t.readFailed)
    }
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      <label className="w-fit cursor-pointer underline underline-offset-2">
        {t.attach} (max {LIMIT_LABEL})
        <input
          type="file"
          multiple
          className="sr-only"
          onChange={(event) => {
            void add(Array.from(event.target.files ?? []))
            event.target.value = ""
          }}
        />
      </label>
      {files.length > 0 && (
        <ul className="text-muted-foreground">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-2">
              <span className="truncate">{file.name}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={t.removeFile(file.name)}
                onClick={() => onChange(files.filter((_, position) => position !== index))}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
