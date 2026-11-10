import { randomUUID } from "node:crypto"
import { getDb } from "@evido/db"
import {
  MAX_ATTACHMENTS_BYTES,
  UPLOAD_CHUNK_BYTES,
  type MailAttachmentRef,
  type MailAttachmentUpload,
} from "@evido/mail-core/types"

export class UploadNotFoundError extends Error {}
export class UploadTooLargeError extends Error {}
export class UploadIncompleteError extends Error {}

/** Files nobody sent are dropped after this. */
const KEEP_MS = 2 * 24 * 60 * 60 * 1000

export async function createUpload(userId: string, file: { name: string; contentType: string; size: number }) {
  if (file.size > MAX_ATTACHMENTS_BYTES) throw new UploadTooLargeError()
  const upload = await getDb().mailUpload.create({
    data: { id: randomUUID(), userId, name: file.name, contentType: file.contentType, size: file.size },
    select: { id: true },
  })
  return upload
}

/** Chunks may arrive in any order and be sent again; each index is stored once. */
export async function putChunk(userId: string, uploadId: string, index: number, bytes: Uint8Array) {
  const db = getDb()
  const upload = await db.mailUpload.findFirst({ where: { id: uploadId, userId }, select: { size: true } })
  if (!upload) throw new UploadNotFoundError()
  // An empty file still sends one, empty, chunk.
  const chunks = Math.max(1, Math.ceil(upload.size / UPLOAD_CHUNK_BYTES))
  const expected = index === chunks - 1 ? upload.size - index * UPLOAD_CHUNK_BYTES : UPLOAD_CHUNK_BYTES
  if (index < 0 || index >= chunks || bytes.length !== expected) throw new UploadIncompleteError()
  await db.mailUploadChunk.upsert({
    where: { uploadId_index: { uploadId, index } },
    create: { uploadId, index, data: Buffer.from(bytes) },
    update: { data: Buffer.from(bytes) },
  })
}

/** The files a message refers to, put back together. Every one must be the user's and complete. */
export async function loadAttachments(userId: string, refs: MailAttachmentRef[]): Promise<MailAttachmentUpload[]> {
  if (refs.length === 0) return []
  const uploads = await getDb().mailUpload.findMany({
    where: { userId, id: { in: refs.map((ref) => ref.uploadId) } },
    include: { chunks: { orderBy: { index: "asc" } } },
  })
  const total = uploads.reduce((sum, upload) => sum + upload.size, 0)
  if (total > MAX_ATTACHMENTS_BYTES) throw new UploadTooLargeError()
  return refs.map((ref) => {
    const upload = uploads.find((item) => item.id === ref.uploadId)
    if (!upload) throw new UploadNotFoundError()
    const bytes = Buffer.concat(upload.chunks.map((chunk) => Buffer.from(chunk.data)))
    if (bytes.length !== upload.size) throw new UploadIncompleteError()
    return { name: upload.name, contentType: upload.contentType, data: bytes.toString("base64") }
  })
}

/** A file from a provider, such as a saved draft's, kept as an upload so the client can refer to it. */
export async function storeAsUpload(userId: string, file: MailAttachmentUpload): Promise<MailAttachmentRef> {
  const bytes = Buffer.from(file.data, "base64")
  const id = randomUUID()
  const chunks = []
  for (let index = 0; index * UPLOAD_CHUNK_BYTES < bytes.length; index++)
    chunks.push({ index, data: bytes.subarray(index * UPLOAD_CHUNK_BYTES, (index + 1) * UPLOAD_CHUNK_BYTES) })
  await getDb().mailUpload.create({
    data: {
      id,
      userId,
      name: file.name,
      contentType: file.contentType,
      size: bytes.length,
      chunks: { create: chunks.length > 0 ? chunks : [{ index: 0, data: Buffer.alloc(0) }] },
    },
  })
  return { uploadId: id, name: file.name, contentType: file.contentType, size: bytes.length }
}

export async function deleteUploads(userId: string, ids: string[]) {
  if (ids.length === 0) return
  await getDb().mailUpload.deleteMany({ where: { userId, id: { in: ids } } })
}

/** Run daily: files that never made it into a sent message. */
export async function dropOldUploads() {
  const { count } = await getDb().mailUpload.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_MS) } } })
  return count
}
