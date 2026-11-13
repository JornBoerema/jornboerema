import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { sortSubIssues, type Command, type Todo, type TodoList, type WorkspaceData } from "@evido/todo-core/workspace";
import { defaultStatus, sortStatuses, type BoardStatus, type TodoAttachment } from "@evido/todo-core/board";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@evido/ui/components/dialog";
import { Button } from "@evido/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@evido/ui/components/alert-dialog";
import { cn } from "@evido/ui/lib/utils";
import { Download, ImageIcon, Kanban, MoreHorizontal, Paperclip, Plus, Share, Trash2, X } from "@/components/icons";
import { useI18n } from "@/i18n";
import { AttachmentTooLarge, downloadAttachment, formatBytes, isImage, uploadAttachment, useAttachmentUrl } from "@/lib/attachments";
import { ImageViewer } from "./image-viewer";
import {
  AssigneeMenu,
  AvatarStack,
  MemberAvatar,
  PriorityIcon,
  PriorityMenu,
  ProjectDot,
  ProjectMenu,
  StatusIcon,
  StatusMenu,
} from "./board-meta";

const DescriptionEditor = lazy(() => import("./description-editor"));

type Run = (command: Command) => Promise<boolean>;

/** Auto-growing title that saves on blur or Enter. */
function TitleField({ value, disabled, label, onSave }: { value: string; disabled: boolean; label: string; onSave: (title: string) => void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  const commit = () => {
    const next = draft.trim();
    if (!next) setDraft(value);
    else if (next !== value) onSave(next);
  };
  return (
    <textarea className="issue-title-field" value={draft} aria-label={label} rows={1} maxLength={500} readOnly={disabled}
      onFocus={() => { focused.current = true; }}
      onChange={(event) => setDraft(event.target.value.replace(/\n/g, " "))}
      onBlur={() => { focused.current = false; commit(); }}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === "Escape") { setDraft(value); }
      }} />
  );
}

/** One file in the attachments grid: a preview for images, the file type for the rest. */
function AttachmentTile({ file, shareToken, locale, canRemove, onOpen, onRemove }: {
  file: TodoAttachment; shareToken?: string; locale: string; canRemove: boolean; onOpen: () => void; onRemove: () => void;
}) {
  const { t: { board: { attachments: t } } } = useI18n();
  const image = isImage(file.contentType);
  const extension = file.name.includes(".") ? file.name.split(".").pop()!.slice(0, 5).toUpperCase() : "";
  return (
    <li className="attachment-tile">
      <button className="attachment-tile-open" aria-label={image ? t.view(file.name) : t.download(file.name)} title={file.name} onClick={onOpen}>
        <span className="attachment-tile-preview">
          {image ? <Preview file={file} shareToken={shareToken} /> : <>
            <Paperclip className="size-5 text-muted-foreground" aria-hidden="true" />
            {extension && <span className="attachment-tile-type">{extension}</span>}
          </>}
        </span>
        <span className="attachment-tile-meta">
          <span className="attachment-tile-name">{file.name}</span>
          <span className="attachment-size">{formatBytes(file.size, locale)}</span>
        </span>
      </button>
      <span className="attachment-tile-actions">
        <Button variant="secondary" size="icon-xs" aria-label={t.download(file.name)} title={t.download(file.name)}
          onClick={() => void downloadAttachment(file, shareToken).catch(() => toast.error(t.downloadFailed))}><Download /></Button>
        {canRemove && <Button variant="secondary" size="icon-xs" aria-label={t.remove(file.name)} title={t.remove(file.name)} onClick={onRemove}><Trash2 /></Button>}
      </span>
    </li>
  );
}

function Preview({ file, shareToken }: { file: TodoAttachment; shareToken?: string }) {
  const url = useAttachmentUrl(file, shareToken);
  if (url === "failed") return <ImageIcon className="size-5 text-muted-foreground" aria-hidden="true" />;
  if (!url) return <span className="attachment-tile-loading" aria-hidden="true" />;
  return <img src={url} alt="" className="attachment-tile-image" draggable={false} />;
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="issue-prop">
      <span className="issue-prop-label">{label}</span>
      {children}
    </div>
  );
}

export function IssueDetail({ issue, list, data, run, readOnly, shareToken, canUpload, onOpen, onClose }: {
  issue: Todo;
  list: TodoList;
  data: WorkspaceData;
  run: Run;
  readOnly: boolean;
  shareToken?: string;
  /** Uploading needs a workspace member's session. */
  canUpload: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const { t: { board: t }, locale } = useI18n();
  const client = useQueryClient();
  const statuses = data.statuses ?? [];
  const projects = data.projects ?? [];
  const members = data.members ?? [];
  const status = statuses.find((s) => s.id === issue.statusId);
  const project = projects.find((p) => p.id === issue.projectId);
  const assignees = members.filter((m) => issue.assigneeIds?.includes(m.id));
  const parent = issue.parentId ? data.todos.find((todo) => todo.id === issue.parentId) : undefined;
  const children = sortSubIssues(data.todos.filter((todo) => todo.parentId === issue.id));
  const childDone = children.filter((child) => child.completed).length;
  const [subTitle, setSubTitle] = useState("");
  const [addingSub, setAddingSub] = useState(false);
  const [uploads, setUploads] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const images = issue.attachments?.filter((file) => isImage(file.contentType)) ?? [];
  const fileInput = useRef<HTMLInputElement>(null);
  const update = (patch: Omit<Extract<Command, { type: "update-issue" }>, "type" | "id">) => void run({ type: "update-issue", id: issue.id, ...patch });
  const ref = (todo: Todo) => `#${todo.number ?? ""}`;

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    let done = 0;
    for (const file of list) {
      setUploads((current) => [...current, file.name]);
      try {
        await uploadAttachment(issue.id, file);
        done++;
      } catch (error) {
        toast.error(error instanceof AttachmentTooLarge ? t.attachments.tooLarge(file.name) : t.attachments.failed(file.name));
      } finally {
        setUploads((current) => {
          const index = current.indexOf(file.name);
          return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)];
        });
      }
    }
    if (done) {
      toast.success(t.attachments.uploaded(done));
      await client.invalidateQueries({ queryKey: ["workspace"] });
    }
  }

  /** A pasted screenshot is called "image.png"; give it a name that says when. */
  function pasted(files: File[]) {
    const stamp = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const when = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}.${pad(stamp.getMinutes())}.${pad(stamp.getSeconds())}`;
    return files.map((file, index) => {
      if (!/^image\.\w+$/i.test(file.name)) return file;
      const extension = file.name.split(".").pop();
      const suffix = files.length > 1 ? ` (${index + 1})` : "";
      return new File([file], `${t.attachments.pastedName(when)}${suffix}.${extension}`, { type: file.type });
    });
  }

  function toggleChild(child: Todo) {
    const sorted = sortStatuses(statuses);
    const next: BoardStatus | undefined = child.completed
      ? defaultStatus(statuses)
      : sorted.find((s) => s.category === "completed");
    if (next) void run({ type: "update-issue", id: child.id, statusId: next.id });
  }

  function addChild(event: React.FormEvent) {
    event.preventDefault();
    const title = subTitle.trim();
    if (!title) return;
    void run({ type: "create-issue", id: crypto.randomUUID(), listId: issue.listId, title, parentId: issue.id, projectId: issue.projectId ?? null });
    setSubTitle("");
  }

  async function copyLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("issue", issue.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      toast.success(t.issue.linkCopied);
    } catch {
      toast.error(url.toString());
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="issue-dialog" showCloseButton={false}
          onDragOver={(event) => { if (canUpload && !readOnly && event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
          onDrop={(event) => { if (!canUpload || readOnly) return; event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files); }}>
          {dragging && <div className="issue-dropzone"><Paperclip className="size-5" aria-hidden="true" />{t.attachments.drop}</div>}
          <header className="issue-topbar">
            <nav className="issue-crumbs" aria-label={t.issue.parent}>
              <Kanban className="size-3.5" aria-hidden="true" />
              <span className="truncate">{list.name}</span>
              {parent && <>
                <span aria-hidden="true">›</span>
                <button className="issue-crumb-link" onClick={() => onOpen(parent.id)}>{ref(parent)} {parent.title}</button>
              </>}
              <span aria-hidden="true">›</span>
              <span className="tabular-nums">{ref(issue)}</span>
            </nav>
            <div className="flex items-center gap-1">
              {!shareToken && <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t.issue.options}><MoreHorizontal /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void copyLink()}><Share aria-hidden="true" />{t.issue.copyLink}</DropdownMenuItem>
                  {!readOnly && <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}><Trash2 aria-hidden="true" />{t.issue.delete}</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>}
              <Button variant="ghost" size="icon-sm" aria-label={t.issue.close} onClick={onClose}><X /></Button>
            </div>
          </header>
          <div className="issue-layout">
            <div className="issue-main">
              <DialogTitle className="sr-only">{ref(issue)} {issue.title}</DialogTitle>
              <DialogDescription className="sr-only">{t.issue.descriptionLabel}</DialogDescription>
              <TitleField value={issue.title} disabled={readOnly} label={t.issue.titleLabel} onSave={(title) => update({ title })} />
              <Suspense fallback={<div className="issue-prose-loading" />}>
                <DescriptionEditor key={issue.id} value={issue.description ?? ""} editable={!readOnly}
                  placeholder={t.issue.descriptionPlaceholder} label={t.issue.descriptionLabel}
                  onPasteFiles={canUpload && !readOnly ? (files) => void upload(pasted(files)) : undefined}
                  onSave={(description) => {
                    void run({ type: "update-issue", id: issue.id, description }).then((ok) => { if (!ok) toast.error(t.issue.descriptionSaveFailed); });
                  }} />
              </Suspense>

              <section className="issue-section" aria-labelledby="sub-issues-heading">
                <div className="issue-section-heading">
                  <h3 id="sub-issues-heading">{t.subIssues.title}{children.length > 0 && <span>{childDone}/{children.length}</span>}</h3>
                  {!readOnly && <Button variant="ghost" size="icon-sm" aria-label={t.subIssues.add} title={t.subIssues.add} onClick={() => setAddingSub(true)}><Plus /></Button>}
                </div>
                {children.length > 0 && <ul className="sub-issue-list">
                  {children.map((child) => {
                    const childStatus = statuses.find((s) => s.id === child.statusId);
                    const childAssignees = members.filter((m) => child.assigneeIds?.includes(m.id));
                    return (
                      <li key={child.id} className={cn("sub-issue", child.completed && "is-complete")}>
                        <button className="sub-issue-toggle" disabled={readOnly} aria-label={t.subIssues.toggle(child.title, child.completed)} onClick={() => toggleChild(child)}>
                          <StatusIcon status={childStatus} />
                        </button>
                        <button className="sub-issue-title" aria-label={t.subIssues.open(child.title)} onClick={() => onOpen(child.id)}>
                          <span className="issue-number">{ref(child)}</span>
                          <span className="truncate">{child.title}</span>
                        </button>
                        {!!child.priority && <PriorityIcon priority={child.priority} />}
                        <AvatarStack members={childAssignees} size={18} />
                      </li>
                    );
                  })}
                </ul>}
                {addingSub && !readOnly && (
                  <form className="sub-issue-form" onSubmit={addChild}>
                    <StatusIcon status={defaultStatus(statuses)} />
                    <input autoFocus value={subTitle} maxLength={500} placeholder={t.subIssues.placeholder} aria-label={t.subIssues.placeholder}
                      onChange={(event) => setSubTitle(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setAddingSub(false); setSubTitle(""); } }}
                      onBlur={() => { if (!subTitle.trim()) setAddingSub(false); }} />
                    <Button type="submit" size="sm" disabled={!subTitle.trim()}>{t.settings.add}</Button>
                  </form>
                )}
              </section>

              <section className="issue-section" aria-labelledby="attachments-heading">
                <div className="issue-section-heading">
                  <h3 id="attachments-heading">{t.attachments.title}{!!issue.attachments?.length && <span>{issue.attachments.length}</span>}</h3>
                  {canUpload && !readOnly && <>
                    <Button variant="ghost" size="icon-sm" aria-label={t.attachments.add} title={t.attachments.add} onClick={() => fileInput.current?.click()}><Plus /></Button>
                    <input ref={fileInput} type="file" multiple hidden onChange={(event) => { if (event.target.files) void upload(event.target.files); event.target.value = ""; }} />
                  </>}
                </div>
                {issue.attachments?.length || uploads.length ? (
                  <ul className="attachment-grid">
                    {issue.attachments?.map((file) => (
                      <AttachmentTile key={file.id} file={file} shareToken={shareToken} locale={locale}
                        canRemove={!readOnly && !shareToken}
                        onOpen={() => isImage(file.contentType)
                          ? setViewing(file.id)
                          : void downloadAttachment(file, shareToken).catch(() => toast.error(t.attachments.downloadFailed))}
                        onRemove={() => void run({ type: "delete-attachment", id: file.id })} />
                    ))}
                    {uploads.map((name, index) => (
                      <li key={`${name}-${index}`} className="attachment-tile is-uploading" aria-live="polite">
                        <span className="attachment-tile-preview"><Paperclip className="size-5 animate-pulse text-muted-foreground" aria-hidden="true" /></span>
                        <span className="attachment-tile-meta"><span className="attachment-tile-name">{t.attachments.uploading(name)}</span></span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="issue-empty-note">{canUpload && !readOnly ? t.attachments.empty : t.attachments.membersOnly}</p>
                )}
              </section>
            </div>

            <aside className="issue-props" aria-label={t.properties.title}>
              <PropertyRow label={t.properties.status}>
                <StatusMenu statuses={statuses} value={issue.statusId} disabled={readOnly} onChange={(statusId) => update({ statusId })}>
                  <button className="issue-prop-value"><StatusIcon status={status} /><span className="truncate">{status?.name ?? "—"}</span></button>
                </StatusMenu>
              </PropertyRow>
              <PropertyRow label={t.properties.priority}>
                <PriorityMenu value={issue.priority ?? 0} disabled={readOnly} onChange={(priority) => update({ priority })}>
                  <button className="issue-prop-value"><PriorityIcon priority={issue.priority ?? 0} /><span>{t.priority.name(issue.priority ?? 0)}</span></button>
                </PriorityMenu>
              </PropertyRow>
              <PropertyRow label={t.properties.assignees}>
                <AssigneeMenu members={members} value={issue.assigneeIds ?? []} disabled={readOnly || !!shareToken} onChange={(assigneeIds) => update({ assigneeIds })}>
                  <button className="issue-prop-value">
                    {assignees.length ? (
                      assignees.length === 1
                        ? <><MemberAvatar member={assignees[0]} size={18} /><span className="truncate">{assignees[0].name || assignees[0].email}</span></>
                        : <AvatarStack members={assignees} size={18} max={5} />
                    ) : <span className="text-muted-foreground">{t.properties.noAssignees}</span>}
                  </button>
                </AssigneeMenu>
              </PropertyRow>
              <PropertyRow label={t.properties.project}>
                <ProjectMenu projects={projects} value={issue.projectId} disabled={readOnly} onChange={(projectId) => update({ projectId })}>
                  <button className="issue-prop-value"><ProjectDot project={project} /><span className={cn("truncate", !project && "text-muted-foreground")}>{project?.name ?? t.properties.noProject}</span></button>
                </ProjectMenu>
              </PropertyRow>
              <PropertyRow label={t.properties.created}>
                <span className="issue-prop-static">{new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(issue.createdAt))}</span>
              </PropertyRow>
            </aside>
          </div>
        </DialogContent>
      </Dialog>
      {viewing && images.some((file) => file.id === viewing) && (
        <ImageViewer images={images} startId={viewing} shareToken={shareToken} onClose={() => setViewing(null)} />
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.issue.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.issue.deleteBody(issue.title)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.issue.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { void run({ type: "delete-todo", id: issue.id }); onClose(); }}>{t.issue.confirmDelete}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
