import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { sortIssues, type Command, type Todo, type TodoList, type WorkspaceData } from "@evido/todo-core/workspace";
import { defaultStatus, sortStatuses, type BoardMember, type BoardProject, type BoardStatus } from "@evido/todo-core/board";
import { Button } from "@evido/ui/components/button";
import { Input } from "@evido/ui/components/input";
import { Textarea } from "@evido/ui/components/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@evido/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@evido/ui/components/empty";
import { cn } from "@evido/ui/lib/utils";
import { Kanban, Layers, ListView, Paperclip, Plus, User } from "@/components/icons";
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
  const project = projects.find((p) => p.id === projectFilter);
  const assignee = members.find((m) => m.id === assigneeFilter);

  return (
    <div className="board">
      <div className="board-toolbar" role="toolbar" aria-label={t.toolbar.view}>
        <p className="board-summary">{t.summary(open)}</p>
        <div className="board-toolbar-actions">
          <div className="board-segment" role="radiogroup" aria-label={t.toolbar.view}>
            {(["board", "list"] as const).map((option) => (
              <button key={option} role="radio" aria-checked={view === option} className={cn(view === option && "is-active")} onClick={() => changeView(option)}>
                {option === "board" ? <Kanban className="size-4" aria-hidden="true" /> : <ListView className="size-4" aria-hidden="true" />}
                <span>{t.toolbar[option]}</span>
              </button>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className={cn("board-filter", projectFilter !== "all" && "is-active")}>
                <ProjectDot project={project} />
                <span className="truncate">{projectFilter === "all" ? t.toolbar.allProjects : projectFilter === "none" ? t.toolbar.noProject : project?.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 min-w-48">
              <DropdownMenuLabel>{t.toolbar.project}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={projectFilter} onValueChange={setProjectFilter}>
                <DropdownMenuRadioItem value="all">{t.toolbar.allProjects}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="none"><ProjectDot />{t.toolbar.noProject}</DropdownMenuRadioItem>
                {projects.map((p) => <DropdownMenuRadioItem key={p.id} value={p.id}><ProjectDot project={p} /><span className="truncate">{p.name}</span></DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {members.length > 0 && <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className={cn("board-filter", assigneeFilter !== "all" && "is-active")}>
                <User className="size-3.5" aria-hidden="true" />
                <span className="truncate">{assigneeFilter === "all" ? t.toolbar.everyone : assigneeFilter === "me" ? t.toolbar.mine : assigneeFilter === "none" ? t.toolbar.unassigned : assignee?.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 min-w-48">
              <DropdownMenuLabel>{t.toolbar.assignee}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={assigneeFilter} onValueChange={setAssigneeFilter}>
                <DropdownMenuRadioItem value="all">{t.toolbar.everyone}</DropdownMenuRadioItem>
                {userId && <DropdownMenuRadioItem value="me">{t.toolbar.mine}</DropdownMenuRadioItem>}
                <DropdownMenuRadioItem value="none">{t.toolbar.unassigned}</DropdownMenuRadioItem>
                {members.filter((m) => m.id !== userId).map((m) => <DropdownMenuRadioItem key={m.id} value={m.id}><span className="truncate">{m.name || m.email}</span></DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={showSub} onCheckedChange={(checked) => { setShowSub(checked); writePref(`${prefKey}:sub`, checked ? "yes" : "no"); }}>
                {t.toolbar.showSubIssues}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>}
          {!readOnly && <Button size="sm" disabled={disabled} onClick={() => setCreating({})}><Plus data-icon="inline-start" />{t.toolbar.newIssue}</Button>}
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
        <NewIssueDialog list={list} statuses={statuses} projects={projects} members={members} run={run} disabled={disabled}
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

function NewIssueDialog({ list, statuses, projects, members, run, disabled, initialStatusId, initialProjectId, onClose }: {
  list: TodoList; statuses: BoardStatus[]; projects: BoardProject[]; members: BoardMember[]; run: Run; disabled: boolean;
  initialStatusId?: string; initialProjectId?: string; onClose: () => void;
}) {
  const { t: { board: t } } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [statusId, setStatusId] = useState(initialStatusId ?? defaultStatus(statuses)?.id);
  const [priority, setPriority] = useState(0);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [projectId, setProjectId] = useState<string | null>(initialProjectId ?? null);
  const titleInput = useRef<HTMLInputElement>(null);
  const status = statuses.find((s) => s.id === statusId);
  const project = projects.find((p) => p.id === projectId);
  const assignees = members.filter((m) => assigneeIds.includes(m.id));
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || disabled) return;
    void run({
      type: "create-issue",
      id: crypto.randomUUID(),
      listId: list.id,
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(statusId ? { statusId } : {}),
      priority,
      assigneeIds,
      projectId,
    });
    onClose();
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl" onOpenAutoFocus={(event) => { event.preventDefault(); titleInput.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle>{t.issue.newTitle}</DialogTitle>
          <DialogDescription>{t.issue.dialogDescription}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input ref={titleInput} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} required
            placeholder={t.issue.titlePlaceholder} aria-label={t.issue.titleLabel} className="h-11 text-base font-medium" />
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={50000} rows={4}
            placeholder={t.issue.descriptionPlaceholder} aria-label={t.issue.descriptionLabel} />
          <div className="flex flex-wrap gap-2">
            <StatusMenu statuses={statuses} value={statusId} onChange={setStatusId}>
              <Button type="button" variant="outline" size="sm"><StatusIcon status={status} />{status?.name}</Button>
            </StatusMenu>
            <PriorityMenu value={priority} onChange={setPriority}>
              <Button type="button" variant="outline" size="sm"><PriorityIcon priority={priority} />{t.priority.name(priority)}</Button>
            </PriorityMenu>
            {members.length > 0 && <AssigneeMenu members={members} value={assigneeIds} onChange={setAssigneeIds}>
              <Button type="button" variant="outline" size="sm">
                {assignees.length ? <AvatarStack members={assignees} size={16} /> : <User className="size-3.5" aria-hidden="true" />}
                {assignees.length === 1 ? assignees[0].name || assignees[0].email : assignees.length ? `${assignees.length}` : t.properties.noAssignees}
              </Button>
            </AssigneeMenu>}
            <ProjectMenu projects={projects} value={projectId ?? undefined} onChange={setProjectId}>
              <Button type="button" variant="outline" size="sm"><ProjectDot project={project} /><span className="max-w-40 truncate">{project?.name ?? t.properties.noProject}</span></Button>
            </ProjectMenu>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t.issue.cancel}</Button>
            <Button type="submit" disabled={disabled || !title.trim()}>{t.issue.create}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
