import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { sortIssues, type Command, type Todo, type TodoList, type WorkspaceData } from "@evido/todo-core/workspace";
import { defaultStatus, sortStatuses, type BoardMember, type BoardProject, type BoardStatus } from "@evido/todo-core/board";
import { Button } from "@evido/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@evido/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@evido/ui/components/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@evido/ui/components/empty";
import { cn } from "@evido/ui/lib/utils";
import { Filter, Folder, Kanban, Layers, ListView, Maximize, Minimize, Paperclip, Plus, User, X } from "@/components/icons";
import { Switch } from "@evido/ui/components/switch";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { AttachmentTooLarge, uploadAttachment } from "@/lib/attachments";
import { useI18n } from "@/i18n";
import {
  AssigneeMenu,
  AvatarStack,
  PriorityIcon,
  PriorityMenu,
  ProjectDot,
  ProjectMenu,
  StatusIcon,
  StatusMenu,
} from "./board-meta";
import { IssueDetail } from "./issue-detail";

type Run = (command: Command) => Promise<boolean>;
type View = "board" | "list";
type Drop = { statusId: string; targetId?: string; placement?: "before" | "after" };
const ISSUE_MIME = "application/x-even-issue";

function readPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const value = localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch { /* Only a preference. */ }
}

export function BoardView({ list, data, run, disabled, readOnly, shareToken, userId, canUpload }: {
  list: TodoList;
  data: WorkspaceData;
  run: Run;
  disabled: boolean;
  readOnly: boolean;
  shareToken?: string;
  userId?: string;
  canUpload: boolean;
}) {
  const { t: { board: t } } = useI18n();
  const [params, setParams] = useSearchParams();
  const prefKey = `even-doen:board:${list.id}`;
  const [view, setView] = useState<View>(() => readPref(`${prefKey}:view`, "board", ["board", "list"] as const));
  const [projectFilter, setProjectFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [showSub, setShowSub] = useState(() => readPref(`${prefKey}:sub`, "no", ["yes", "no"] as const) === "yes");
  const [creating, setCreating] = useState<{ statusId?: string } | null>(null);
  const statuses = useMemo(() => sortStatuses(data.statuses ?? []), [data.statuses]);
  const projects = data.projects ?? [];
  const members = data.members ?? [];
  const locked = disabled || readOnly;

  const all = data.todos.filter((todo) => todo.listId === list.id);
  const visible = all.filter((issue) =>
    (showSub || !issue.parentId) &&
    (projectFilter === "all" || (projectFilter === "none" ? !issue.projectId : issue.projectId === projectFilter)) &&
    (assigneeFilter === "all" ||
      (assigneeFilter === "none" ? !issue.assigneeIds?.length : issue.assigneeIds?.includes(assigneeFilter === "me" ? userId ?? "" : assigneeFilter))),
  );
  // Issues whose status was removed show in the first column until moved.
  const fallback = statuses[0]?.id;
  const columnOf = (issue: Todo) => (statuses.some((s) => s.id === issue.statusId) ? issue.statusId! : fallback);
  const columns = statuses.map((status) => ({ status, issues: sortIssues(visible.filter((issue) => columnOf(issue) === status.id)) }));
  const open = all.filter((issue) => !issue.parentId && !issue.completed).length;

  const issueId = params.get("issue");
  const openIssue = issueId ? all.find((issue) => issue.id === issueId) : undefined;
  const setIssue = (id: string | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set("issue", id);
      else next.delete("issue");
      return next;
    });
  // The open issue was deleted (here or elsewhere): close it.
  useEffect(() => {
    if (issueId && !openIssue && !disabled) setIssue(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId, openIssue]);

  const changeView = (next: View) => { setView(next); writePref(`${prefKey}:view`, next); };
  const filtered = projectFilter !== "all" || assigneeFilter !== "all";
  const filterCount = Number(projectFilter !== "all") + Number(assigneeFilter !== "all") + Number(showSub);
  const project = projects.find((p) => p.id === projectFilter);
  const assignee = members.find((m) => m.id === assigneeFilter);

  return (
    <div className="board">
      <div className="board-toolbar" role="toolbar" aria-label={t.toolbar.view}>
        <div className="board-toolbar-group">
          <div className="board-tabs" role="radiogroup" aria-label={t.toolbar.view}>
            {(["board", "list"] as const).map((option) => (
              <button key={option} role="radio" aria-checked={view === option} className={cn("board-tool", view === option && "is-active")} onClick={() => changeView(option)}>
                {option === "board" ? <Kanban className="size-3.5" aria-hidden="true" /> : <ListView className="size-3.5" aria-hidden="true" />}
                <span>{t.toolbar[option]}</span>
              </button>
            ))}
          </div>
          <span className="board-toolbar-divider" aria-hidden="true" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={cn("board-tool", filterCount > 0 && "has-value")}>
                <Filter className="size-3.5" aria-hidden="true" />
                <span>{t.toolbar.filter}</span>
                {filterCount > 0 && <span className="board-tool-count">{filterCount}</span>}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="board-menu min-w-44">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><Folder className="size-3.5" aria-hidden="true" />{t.toolbar.project}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="board-menu max-h-80 min-w-40">
                  <DropdownMenuRadioGroup value={projectFilter} onValueChange={setProjectFilter}>
                    <DropdownMenuRadioItem value="all">{t.toolbar.allProjects}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="none"><ProjectDot />{t.toolbar.noProject}</DropdownMenuRadioItem>
                    {projects.map((p) => <DropdownMenuRadioItem key={p.id} value={p.id}><ProjectDot project={p} /><span className="truncate">{p.name}</span></DropdownMenuRadioItem>)}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {members.length > 0 && <DropdownMenuSub>
                <DropdownMenuSubTrigger><User className="size-3.5" aria-hidden="true" />{t.toolbar.assignee}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="board-menu max-h-80 min-w-40">
                  <DropdownMenuRadioGroup value={assigneeFilter} onValueChange={setAssigneeFilter}>
                    <DropdownMenuRadioItem value="all">{t.toolbar.everyone}</DropdownMenuRadioItem>
                    {userId && <DropdownMenuRadioItem value="me">{t.toolbar.mine}</DropdownMenuRadioItem>}
                    <DropdownMenuRadioItem value="none">{t.toolbar.unassigned}</DropdownMenuRadioItem>
                    {members.filter((m) => m.id !== userId).map((m) => <DropdownMenuRadioItem key={m.id} value={m.id}><span className="truncate">{m.name || m.email}</span></DropdownMenuRadioItem>)}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={showSub} onCheckedChange={(checked) => { setShowSub(checked); writePref(`${prefKey}:sub`, checked ? "yes" : "no"); }}>
                <Layers className="size-3.5" aria-hidden="true" />{t.toolbar.showSubIssues}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Active filters as removable chips, like Linear. */}
          {projectFilter !== "all" && (
            <span className="board-filter-chip">
              <ProjectDot project={project} />
              <span className="truncate">{projectFilter === "none" ? t.toolbar.noProject : project?.name}</span>
              <button aria-label={t.toolbar.clearFilter(t.toolbar.project)} onClick={() => setProjectFilter("all")}><X className="size-3" /></button>
            </span>
          )}
          {assigneeFilter !== "all" && (
            <span className="board-filter-chip">
              <User className="size-3.5" aria-hidden="true" />
              <span className="truncate">{assigneeFilter === "me" ? t.toolbar.mine : assigneeFilter === "none" ? t.toolbar.unassigned : assignee?.name}</span>
              <button aria-label={t.toolbar.clearFilter(t.toolbar.assignee)} onClick={() => setAssigneeFilter("all")}><X className="size-3" /></button>
            </span>
          )}
        </div>
        <div className="board-toolbar-group">
          <span className="board-summary">{t.summary(open)}</span>
          {!readOnly && <button className="board-tool is-primary" disabled={disabled} onClick={() => setCreating({})}><Plus className="size-3.5" aria-hidden="true" /><span>{t.toolbar.newIssue}</span></button>}
        </div>
      </div>
      {!all.length ? (
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyMedia><Kanban className="size-7 text-muted-foreground" /></EmptyMedia>
            <EmptyTitle>{t.empty.title}</EmptyTitle>
            <EmptyDescription>{readOnly ? t.empty.readOnly : t.empty.body}</EmptyDescription>
          </EmptyHeader>
          {!readOnly && <EmptyContent><Button disabled={disabled} onClick={() => setCreating({})}><Plus data-icon="inline-start" />{t.toolbar.newIssue}</Button></EmptyContent>}
        </Empty>
      ) : view === "board" ? (
        <KanbanBoard columns={columns} data={data} locked={locked} run={run} onOpen={setIssue} onCreate={(statusId) => setCreating({ statusId })} />
      ) : (
        <IssueList columns={columns} data={data} locked={locked} run={run} onOpen={setIssue} onCreate={(statusId) => setCreating({ statusId })} />
      )}
      {filtered && all.length > 0 && !visible.length && <p className="board-filter-empty">{t.empty.filtered}</p>}

      {creating && (
        <NewIssueDialog list={list} statuses={statuses} projects={projects} members={members} run={run} disabled={disabled} canUpload={canUpload}
          initialStatusId={creating.statusId} initialProjectId={projectFilter !== "all" && projectFilter !== "none" ? projectFilter : undefined}
          onClose={() => setCreating(null)} />
      )}
      {openIssue && (
        <IssueDetail issue={openIssue} list={list} data={data} run={run} readOnly={locked} shareToken={shareToken}
          canUpload={canUpload && !disabled} onOpen={setIssue} onClose={() => setIssue(null)} />
      )}
    </div>
  );
}

type Column = { status: BoardStatus; issues: Todo[] };
type ViewProps = { columns: Column[]; data: WorkspaceData; locked: boolean; run: Run; onOpen: (id: string) => void; onCreate: (statusId: string) => void };

function IssueChips({ issue, data, compact }: { issue: Todo; data: WorkspaceData; compact?: boolean }) {
  const { t: { board: t } } = useI18n();
  const project = data.projects?.find((p) => p.id === issue.projectId);
  const children = data.todos.filter((todo) => todo.parentId === issue.id);
  const done = children.filter((child) => child.completed).length;
  return (
    <>
      {!!issue.priority && !compact && <span className="issue-chip" title={t.priority.name(issue.priority)}><PriorityIcon priority={issue.priority} /><span className="sr-only">{t.priority.name(issue.priority)}</span></span>}
      {project && <span className="issue-chip"><ProjectDot project={project} /><span className="truncate">{project.name}</span></span>}
      {children.length > 0 && <span className="issue-chip" title={t.card.subIssuesLabel(done, children.length)}><Layers className="size-3.5" aria-hidden="true" />{t.card.subIssues(done, children.length)}<span className="sr-only">{t.card.subIssuesLabel(done, children.length)}</span></span>}
      {!!issue.attachments?.length && <span className="issue-chip" title={t.card.attachments(issue.attachments.length)}><Paperclip className="size-3.5" aria-hidden="true" />{issue.attachments.length}<span className="sr-only">{t.card.attachments(issue.attachments.length)}</span></span>}
    </>
  );
}

function KanbanBoard({ columns, data, locked, run, onOpen, onCreate }: ViewProps) {
  const { t: { board: t } } = useI18n();
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const members = data.members ?? [];

  function target(event: React.DragEvent<HTMLElement>, column: Column): Drop {
    const cards = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-issue-id]")].filter((card) => card.dataset.issueId !== dragId);
    const before = cards.find((card) => {
      const box = card.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
    if (before) return { statusId: column.status.id, targetId: before.dataset.issueId, placement: "before" };
    const last = cards.at(-1);
    return { statusId: column.status.id, targetId: last?.dataset.issueId, placement: last ? "after" : undefined };
  }
  async function finish(drop: Drop) {
    const id = dragId;
    setDragId(null);
    setDrop(null);
    if (!id) return;
    const ok = await run({ type: "move-issue", id, ...drop });
    const status = columns.find((c) => c.status.id === drop.statusId)?.status;
    if (ok && status) setAnnouncement(t.card.moved(status.name));
  }

  return (
    <div className="kanban" aria-describedby={locked ? undefined : "kanban-help"}>
      <p id="kanban-help" className="sr-only">{t.card.dragHelp}</p>
      <p className="sr-only" role="status">{announcement}</p>
      {columns.map((column) => (
        <section key={column.status.id} className={cn("kanban-column", drop?.statusId === column.status.id && "is-drop-target")}
          aria-label={t.column.label(column.status.name, column.issues.length)}
          onDragOver={(event) => {
            if (!dragId || locked) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const next = target(event, column);
            if (next.statusId !== drop?.statusId || next.targetId !== drop?.targetId || next.placement !== drop?.placement) setDrop(next);
          }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDrop((current) => current?.statusId === column.status.id ? null : current); }}
          onDrop={(event) => { if (!dragId || locked) return; event.preventDefault(); void finish(target(event, column)); }}>
          <header className="kanban-column-header">
            <StatusIcon status={column.status} />
            <h2>{column.status.name}</h2>
            <span className="kanban-count">{column.issues.length}</span>
            {!locked && <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={t.column.add(column.status.name)} title={t.column.add(column.status.name)} onClick={() => onCreate(column.status.id)}><Plus /></Button>}
          </header>
          <div className="kanban-cards">
            {column.issues.map((issue) => {
              const assignees = members.filter((m) => issue.assigneeIds?.includes(m.id));
              const showLine = drop?.statusId === column.status.id && drop.targetId === issue.id;
              return (
                <div key={issue.id} className="kanban-slot">
                  {showLine && drop?.placement === "before" && <div className="kanban-drop-line" />}
                  <button data-issue-id={issue.id} className={cn("issue-card", dragId === issue.id && "is-dragging", issue.completed && "is-complete")}
                    draggable={!locked} aria-label={t.card.open(issue.number ?? 0, issue.title)}
                    onDragStart={(event) => { event.dataTransfer.setData(ISSUE_MIME, issue.id); event.dataTransfer.effectAllowed = "move"; setDragId(issue.id); }}
                    onDragEnd={() => { setDragId(null); setDrop(null); }}
                    onClick={() => onOpen(issue.id)}>
                    <span className="issue-card-top">
                      <span className="issue-number">#{issue.number}</span>
                      <AvatarStack members={assignees} size={18} />
                    </span>
                    <span className="issue-card-title">{issue.title}</span>
                    <span className="issue-card-chips"><IssueChips issue={issue} data={data} /></span>
                  </button>
                  {showLine && drop?.placement === "after" && <div className="kanban-drop-line" />}
                </div>
              );
            })}
            {!column.issues.length && <div className={cn("kanban-empty", drop?.statusId === column.status.id && "is-drop-target")}>{t.column.empty}</div>}
          </div>
        </section>
      ))}
    </div>
  );
}

function IssueList({ columns, data, locked, run, onOpen, onCreate }: ViewProps) {
  const { t: { board: t } } = useI18n();
  const members = data.members ?? [];
  const statuses = data.statuses ?? [];
  return (
    <div className="issue-list">
      {columns.filter((column) => column.issues.length).map((column) => (
        <section key={column.status.id} aria-label={t.column.label(column.status.name, column.issues.length)}>
          <header className="issue-list-header">
            <StatusIcon status={column.status} />
            <h2>{column.status.name}</h2>
            <span className="kanban-count">{column.issues.length}</span>
            {!locked && <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={t.column.add(column.status.name)} title={t.column.add(column.status.name)} onClick={() => onCreate(column.status.id)}><Plus /></Button>}
          </header>
          <ul>
            {column.issues.map((issue) => (
              // The row opens the issue; its own buttons (priority, status, title) keep their action.
              <li key={issue.id} className={cn("issue-row", issue.completed && "is-complete")}
                onClick={(event) => { if (!(event.target as HTMLElement).closest("button, [role=menu]")) onOpen(issue.id); }}>
                <PriorityMenu value={issue.priority ?? 0} disabled={locked} onChange={(priority) => void run({ type: "update-issue", id: issue.id, priority })}>
                  <button className="issue-row-icon" data-priority={issue.priority ?? 0} aria-label={`${t.properties.priority}: ${t.priority.name(issue.priority ?? 0)}`}><PriorityIcon priority={issue.priority ?? 0} /></button>
                </PriorityMenu>
                <span className="issue-number">#{issue.number}</span>
                <StatusMenu statuses={statuses} value={issue.statusId} disabled={locked} onChange={(statusId) => void run({ type: "update-issue", id: issue.id, statusId })}>
                  <button className="issue-row-icon" aria-label={`${t.properties.status}: ${column.status.name}`}><StatusIcon status={column.status} /></button>
                </StatusMenu>
                <button className="issue-row-title" onClick={() => onOpen(issue.id)} aria-label={t.card.open(issue.number ?? 0, issue.title)}>
                  <span className="truncate">{issue.title}</span>
                </button>
                <span className="issue-row-meta"><IssueChips issue={issue} data={data} compact /></span>
                <AvatarStack members={members.filter((m) => issue.assigneeIds?.includes(m.id))} size={20} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function NewIssueDialog({ list, statuses, projects, members, run, disabled, canUpload, initialStatusId, initialProjectId, onClose }: {
  list: TodoList; statuses: BoardStatus[]; projects: BoardProject[]; members: BoardMember[]; run: Run; disabled: boolean; canUpload: boolean;
  initialStatusId?: string; initialProjectId?: string; onClose: () => void;
}) {
  const { t: { board: t } } = useI18n();
  const client = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [statusId, setStatusId] = useState(initialStatusId ?? defaultStatus(statuses)?.id);
  const [priority, setPriority] = useState(0);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [projectId, setProjectId] = useState<string | null>(initialProjectId ?? null);
  const [files, setFiles] = useState<File[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [more, setMore] = useState(false);
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const status = statuses.find((s) => s.id === statusId);
  const project = projects.find((p) => p.id === projectId);
  const assignees = members.filter((m) => assigneeIds.includes(m.id));
  function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!title.trim() || disabled) return;
    const id = crypto.randomUUID();
    const attach = files;
    void run({
      type: "create-issue",
      id,
      listId: list.id,
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(statusId ? { statusId } : {}),
      priority,
      assigneeIds,
      projectId,
    }).then(async (saved) => {
      // Files need the issue on the server first.
      if (!saved || !attach.length) return;
      for (const file of attach)
        await uploadAttachment(id, file).catch((error) =>
          toast.error(error instanceof AttachmentTooLarge ? t.attachments.tooLarge(file.name) : t.attachments.failed(file.name)));
      await client.invalidateQueries({ queryKey: ["workspace"] });
    });
    if (!more) return onClose();
    // "Create more": keep the properties, start a fresh title.
    setTitle("");
    setDescription("");
    setFiles([]);
    titleInput.current?.focus();
  }
  const chip = "new-issue-chip";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false}
        className={cn("new-issue-dialog top-[14vh] translate-y-0 gap-0 p-0 sm:max-w-[680px] data-open:zoom-in-[0.98]", expanded && "is-expanded sm:max-w-[920px]")}
        onOpenAutoFocus={(event) => { event.preventDefault(); titleInput.current?.focus(); }}>
        <form onSubmit={submit} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(event); }}>
          <header className="new-issue-header">
            <span className="new-issue-crumb"><Kanban className="size-3.5" aria-hidden="true" /><span className="truncate">{list.name}</span></span>
            <span className="text-muted-foreground" aria-hidden="true">›</span>
            <DialogTitle className="new-issue-heading">{t.issue.newTitle}</DialogTitle>
            <DialogDescription className="sr-only">{t.issue.dialogDescription}</DialogDescription>
            <span className="ml-auto flex items-center gap-0.5">
              <Button type="button" variant="ghost" size="icon-sm" aria-label={expanded ? t.issue.collapse : t.issue.expand} title={expanded ? t.issue.collapse : t.issue.expand} onClick={() => setExpanded(!expanded)}>
                {expanded ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t.issue.close} onClick={onClose}><X /></Button>
            </span>
          </header>
          <div className="new-issue-body">
            <textarea ref={titleInput} rows={1} value={title} maxLength={500} required className="new-issue-title"
              placeholder={t.issue.titlePlaceholder} aria-label={t.issue.titleLabel}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) e.preventDefault(); }} />
            <textarea rows={expanded ? 10 : 3} value={description} maxLength={50000} className="new-issue-description"
              placeholder={t.issue.descriptionPlaceholder} aria-label={t.issue.descriptionLabel}
              onChange={(e) => setDescription(e.target.value)} />
            <div className="new-issue-chips">
              <StatusMenu statuses={statuses} value={statusId} onChange={setStatusId}>
                <button type="button" className={chip}><StatusIcon status={status} />{status?.name}</button>
              </StatusMenu>
              <PriorityMenu value={priority} onChange={setPriority}>
                <button type="button" className={cn(chip, !priority && "is-empty")}><PriorityIcon priority={priority} />{priority ? t.priority.name(priority) : t.properties.priority}</button>
              </PriorityMenu>
              {members.length > 0 && <AssigneeMenu members={members} value={assigneeIds} onChange={setAssigneeIds}>
                <button type="button" className={cn(chip, !assignees.length && "is-empty")}>
                  {assignees.length ? <AvatarStack members={assignees} size={16} /> : <User className="size-3.5" aria-hidden="true" />}
                  <span className="max-w-40 truncate">{assignees.length === 1 ? assignees[0].name || assignees[0].email : assignees.length ? t.properties.assigneeCount(assignees.length) : t.properties.assignee}</span>
                </button>
              </AssigneeMenu>}
              <ProjectMenu projects={projects} value={projectId ?? undefined} onChange={setProjectId}>
                <button type="button" className={cn(chip, !project && "is-empty")}><ProjectDot project={project} /><span className="max-w-40 truncate">{project?.name ?? t.properties.project}</span></button>
              </ProjectMenu>
            </div>
            {files.length > 0 && (
              <ul className="new-issue-files">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="new-issue-file">
                    <Paperclip className="size-3.5" aria-hidden="true" />
                    <span className="truncate">{file.name}</span>
                    <button type="button" aria-label={t.attachments.remove(file.name)} onClick={() => setFiles(files.filter((_, i) => i !== index))}><X className="size-3" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <footer className="new-issue-footer">
            {canUpload && <>
              <Button type="button" variant="ghost" size="icon-sm" className="rounded-full" aria-label={t.attachments.add} title={t.attachments.add} onClick={() => fileInput.current?.click()}><Paperclip /></Button>
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) setFiles([...files, ...e.target.files]); e.target.value = ""; }} />
            </>}
            <label className="new-issue-more">
              <Switch size="sm" checked={more} onCheckedChange={setMore} />
              {t.issue.createMore}
            </label>
            <Button type="submit" size="sm" disabled={disabled || !title.trim()} title="⌘↵">{t.issue.create}</Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
