import { useEffect, useState } from "react";
import { MAX_ATTACHMENT_BYTES } from "@evido/todo-core/board";
import { apiFetch } from "@/lib/api";

export class AttachmentTooLarge extends Error {}

async function ok(response: Response) {
  if (response.ok) return response;
  const body = await response.json().catch(() => null);
  throw new Error(body?.error ?? response.statusText);
}

/** Sends a file in chunks (each below Vercel's request limit), then shows it on the issue. */
export async function uploadAttachment(todoId: string, file: File) {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new AttachmentTooLarge();
  const created = await ok(
    await apiFetch("/api/todo-attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ todoId, name: file.name, contentType: file.type || "application/octet-stream", size: file.size }),
    }),
  );
  const { id, chunkBytes } = (await created.json()) as { id: string; chunkBytes: number };
  const chunks = Math.max(1, Math.ceil(file.size / chunkBytes));
  for (let index = 0; index < chunks; index++)
    await ok(
      await apiFetch(`/api/todo-attachments/${id}/chunks/${index}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: file.slice(index * chunkBytes, (index + 1) * chunkBytes),
      }),
    );
  await ok(await apiFetch(`/api/todo-attachments/${id}/complete`, { method: "POST" }));
}

/** Image types a browser shows safely in an <img>. */
export const isImage = (contentType: string) => /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/i.test(contentType);

/** The file's bytes, fetched with the session (cookie or desktop bearer) or a share link. */
export async function fetchAttachment(attachment: { id: string }, shareToken?: string) {
  const path = shareToken ? `/api/shared/${shareToken}/attachments/${attachment.id}` : `/api/todo-attachments/${attachment.id}`;
  return (await ok(await apiFetch(path))).blob();
}

// Files never change after upload, so one object URL per file serves previews and the viewer.
const objectUrls = new Map<string, Promise<string>>();
export function attachmentUrl(attachment: { id: string }, shareToken?: string) {
  let url = objectUrls.get(attachment.id);
  if (!url) {
    url = fetchAttachment(attachment, shareToken).then((blob) => URL.createObjectURL(blob));
    url.catch(() => objectUrls.delete(attachment.id)); // A later look tries again.
    objectUrls.set(attachment.id, url);
  }
  return url;
}

/** Object URL of an attachment: undefined while loading, "failed" when it didn't load. */
export function useAttachmentUrl(attachment: { id: string }, shareToken?: string) {
  const [state, setState] = useState<{ id: string; url: string } | null>(null);
  const id = attachment.id;
  useEffect(() => {
    let live = true;
    attachmentUrl({ id }, shareToken).then(
      (url) => live && setState({ id, url }),
      () => live && setState({ id, url: "failed" }),
    );
    return () => { live = false; };
  }, [id, shareToken]);
  return state?.id === id ? state.url : undefined;
}

/** Saved like a normal download. */
export async function downloadAttachment(attachment: { id: string; name: string }, shareToken?: string) {
  const url = URL.createObjectURL(await fetchAttachment(attachment, shareToken));
  const link = document.createElement("a");
  link.href = url;
  link.download = attachment.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function formatBytes(bytes: number, locale: string) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 1 : 0 }).format(value)} ${units[unit]}`;
}
