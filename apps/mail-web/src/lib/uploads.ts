import { useMemo } from "react"
import { UPLOAD_CHUNK_BYTES, type MailAttachmentRef } from "@evido/mail-core/types"
import { api } from "./api"

/** A file in a composer: uploading, uploaded, or failed. */
export type ComposerFile = {
  /** Stable while the file is in the composer, also before it has an upload id. */
  key: string
  name: string
  contentType: string
  size: number
  uploadId: string | null
  /** 0 to 1. */
  progress: number
  failed: boolean
}

export const isUploaded = (file: ComposerFile) => file.uploadId !== null && file.progress >= 1 && !file.failed

export const isUploading = (files: ComposerFile[]) => files.some((file) => !file.failed && file.progress < 1)

export const fromRefs = (refs: MailAttachmentRef[]): ComposerFile[] =>
  refs.map((ref) => ({ ...ref, key: ref.uploadId, progress: 1, failed: false }))

const toRefs = (files: ComposerFile[]): MailAttachmentRef[] =>
  files.filter(isUploaded).map(({ uploadId, name, contentType, size }) => ({
    uploadId: uploadId as string,
    name,
    contentType,
    size,
  }))

/**
 * The finished files, the same array until one finishes or goes. Draft autosave
 * compares files by identity, so progress alone mustn't look like a change.
 */
export function useAttachmentRefs(files: ComposerFile[]) {
  const key = JSON.stringify(toRefs(files))
  return useMemo(() => JSON.parse(key) as MailAttachmentRef[], [key])
}

/**
 * Sends a file in chunks, one request each, so no request comes near the
 * server's size limit. Resolves with the upload id.
 */
export async function uploadFile(
  file: File,
  { onStart, onProgress, signal }: { onStart: (id: string) => void; onProgress: (progress: number) => void; signal: AbortSignal }
) {
  const { id } = await api<{ id: string }>("/api/mail/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, contentType: file.type || "application/octet-stream", size: file.size }),
    signal,
  })
  onStart(id)
  const chunks = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK_BYTES))
  for (let index = 0; index < chunks; index++) {
    const part = file.slice(index * UPLOAD_CHUNK_BYTES, (index + 1) * UPLOAD_CHUNK_BYTES)
    await api(`/api/mail/uploads/${id}/chunks/${index}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: part,
      signal,
    })
    onProgress((index + 1) / chunks)
  }
  return id
}

export const deleteUpload = (id: string) =>
  api(`/api/mail/uploads/${id}`, { method: "DELETE" }).catch(() => undefined)
