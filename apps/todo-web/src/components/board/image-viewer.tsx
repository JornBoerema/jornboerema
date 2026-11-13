import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { TodoAttachment } from "@evido/todo-core/board";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@evido/ui/components/dialog";
import { Button } from "@evido/ui/components/button";
import { ChevronLeft, ChevronRight, Download, LoaderCircle, X } from "@/components/icons";
import { useI18n } from "@/i18n";
import { attachmentUrl, downloadAttachment, useAttachmentUrl } from "@/lib/attachments";

/** Image attachments full screen; ← and → step through the issue's images. */
export function ImageViewer({ images, startId, shareToken, onClose }: {
  images: TodoAttachment[];
  startId: string;
  shareToken?: string;
  onClose: () => void;
}) {
  const { t: { board: { attachments: t } } } = useI18n();
  const [currentId, setCurrentId] = useState(startId);
  const index = Math.max(0, images.findIndex((image) => image.id === currentId));
  const image = images[index];
  const url = useAttachmentUrl(image ?? images[0], shareToken);
  const step = (by: number) => {
    if (images.length > 1) setCurrentId(images[(index + by + images.length) % images.length].id);
  };
  // Loads the neighbours too, so stepping feels instant.
  useEffect(() => {
    if (images.length < 2) return;
    for (const by of [1, -1]) void attachmentUrl(images[(index + by + images.length) % images.length], shareToken).catch(() => {});
  }, [images, index, shareToken]);

  if (!image) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="image-viewer"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
          if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
        }}>
        <header className="image-viewer-bar">
          <DialogTitle className="image-viewer-name">{image.name}</DialogTitle>
          <DialogDescription className="sr-only">{t.viewerHelp}</DialogDescription>
          {images.length > 1 && <span className="image-viewer-count">{t.counter(index + 1, images.length)}</span>}
          <span className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label={t.download(image.name)} title={t.download(image.name)}
              onClick={() => void downloadAttachment(image, shareToken).catch(() => toast.error(t.downloadFailed))}><Download /></Button>
            <Button variant="ghost" size="icon-sm" aria-label={t.closeViewer} title={t.closeViewer} onClick={onClose}><X /></Button>
          </span>
        </header>
        {/* Clicking beside the image closes, like most viewers. */}
        <div className="image-viewer-stage" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
          {url === "failed" ? (
            <p className="image-viewer-note">{t.viewFailed}</p>
          ) : url ? (
            <img key={image.id} src={url} alt={image.name} className="image-viewer-image" />
          ) : (
            <LoaderCircle className="size-6 animate-spin text-white/60" aria-label={t.loading} />
          )}
          {images.length > 1 && <>
            <button className="image-viewer-step is-prev" aria-label={t.previous} title={t.previous} onClick={() => step(-1)}><ChevronLeft className="size-5" /></button>
            <button className="image-viewer-step is-next" aria-label={t.next} title={t.next} onClick={() => step(1)}><ChevronRight className="size-5" /></button>
          </>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
