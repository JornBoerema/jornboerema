import { AppSwitcher, useInDesktop } from "@evido/ui/components/app-switcher";
import { UpdateButton } from "@evido/ui/components/desktop-app";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { motion } from "motion/react";
import {
  Download,
  Note,
  Home,
  SidebarToggle,
  CloudCheck,
  CloudOff,
  CheckCheck,
  ListTodo,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Share,
  Trash2,
} from "@/components/icons";
import { ListSpotlight } from "@/components/list-spotlight";
import { WorkspaceSettings } from "@/components/settings/workspace-settings";
import { useWorkspaceMenu, WorkspaceSwitcher } from "@/components/workspace-switcher";
import type { WorkspaceSummary } from "@evido/todo-core/workspaces";
import {
  sortTodos,
  taskStatus,
  type WorkspaceData,
  type Todo,
  type Command,
} from "@evido/todo-core/workspace";
import { InlineName } from "@/components/inline-name";
import { WorkspaceDashboard } from "@/components/workspace-dashboard";
import { Sortable } from "@/components/sortable";
import { ShareListDialog } from "@/components/share-list-dialog";
import type { TodoList } from "@evido/todo-core/workspace";
import { useWorkspace } from "@/hooks/use-workspace";
import { useI18n } from "@/i18n";
import { cn } from "@evido/ui/lib/utils";
import { useCollapsibleSidebar } from "@evido/ui/hooks/use-collapsible-sidebar";
import { useScrollFade } from "@evido/ui/hooks/use-scroll-fade";
import { Brand } from "@/components/brand";
import { Button } from "@evido/ui/components/button";
import { Checkbox } from "@evido/ui/components/checkbox";
import { Input } from "@evido/ui/components/input";
import { InputGroup, InputGroupInput, InputGroupAddon, InputGroupButton } from "@evido/ui/components/input-group";
import { Field, FieldGroup, FieldLabel } from "@evido/ui/components/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@evido/ui/components/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@evido/ui/components/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@evido/ui/components/dropdown-menu";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from "@evido/ui/components/empty";
import { Alert, AlertTitle, AlertDescription } from "@evido/ui/components/alert";

const NoteEditor = lazy(() => import("@/components/note-editor"));

type Editor = {
  type: "create-list" | "update-todo";
  id?: string;
  value: string;
  kind?: "todo" | "note";
};
type Deletion =
  | { type: "delete-list" | "delete-todo"; id: string; title: string }
  | { type: "clear-done"; listId: string; count: number };
export function WorkspaceApp({
  user,
  workspaces = [],
  activeWorkspace,
  onSelectWorkspace,
  initialData,
  realtimeEnabled,
  shareToken,
}: {
  user?: { id: string; name: string; email: string };
  workspaces?: WorkspaceSummary[];
  activeWorkspace?: WorkspaceSummary;
  onSelectWorkspace?: (id: string) => void;
  initialData: WorkspaceData;
  realtimeEnabled: boolean;
  shareToken?: string;
}) {
  const { t: { workspace: t } } = useI18n();
  // Workspaces, settings and sign-out: the footer menu on the web, the brand's menu in the desktop app.
  const desktop = useInDesktop();
  const workspaceMenu = useWorkspaceMenu(
    user && activeWorkspace && onSelectWorkspace
      ? { user, workspaces, active: activeWorkspace, onSelect: onSelectWorkspace }
      : null
  );
  const { data, run, pending, online, connection, error, refresh, unavailable } =
    useWorkspace(user?.id ?? "guest", activeWorkspace?.id ?? "", initialData, realtimeEnabled, shareToken);
  const listEndpoint = shareToken
    ? `/api/shared/${shareToken}`
    : `/api/workspace?workspaceId=${encodeURIComponent(activeWorkspace?.id ?? "")}`;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const selectedId = searchParams.get("list");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  const [sharingList, setSharingList] = useState<TodoList | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar, expandButton: sidebarExpand } = useCollapsibleSidebar({ enabled: !shareToken });
  const listScroller = useScrollFade<HTMLDivElement>();
  const pageScroller = useScrollFade<HTMLDivElement>();
  const taskInput = useRef<HTMLInputElement>(null);
  const noteDownload = useRef<(() => void) | null>(null);
  const noteSave = useRef<(() => Promise<boolean>) | null>(null);
  const showDashboard = !shareToken && !selectedId;
  const selected = showDashboard ? undefined : data.lists.find((l) => l.id === selectedId) ?? data.lists[0];
  async function showOverview() {
    if (noteSave.current && !(await noteSave.current())) return;
    const next = new URLSearchParams(window.location.search);
    next.delete("list");
    navigate({ search: next.toString() });
    setTaskTitle("");
  }
  const activeListId = selected?.id;
  async function selectList(id: string) {
    if (noteSave.current && !(await noteSave.current())) return;
    const next = new URLSearchParams(window.location.search);
    if (next.get("list") !== id) {
      next.set("list", id);
      navigate({ search: next.toString() });
    }
    setTaskTitle("");
  }
  useEffect(() => {
    // Wait for mutations to settle before replacing a missing/deleted selection.
    if (pending || selectedId === (activeListId ?? null)) return;
    const url = new URL(window.location.href);
    if (url.pathname !== "/" || url.searchParams.get("list") !== selectedId) return;
    if (activeListId) url.searchParams.set("list", activeListId);
    else url.searchParams.delete("list");
    navigate({ search: url.searchParams.toString() }, { replace: true });
  }, [activeListId, selectedId, pending, navigate]);
  useEffect(() => {
    document.title = selected?.name ? t.pageTitle(selected.name) : t.overviewTitle;
  }, [selected?.name, t]);
  const items = sortTodos(data.todos.filter((t) => t.listId === selected?.id));
  const canEditTasks = selected?.role !== "viewer";
  const remaining = items.filter((t) => !t.completed).length;
  const doneCount = items.length - remaining;
  const canClearDone = selected?.kind !== "note" && canEditTasks && doneCount > 0;
  const hasListMenu = selected?.kind === "note" || canClearDone || selected?.role === "owner";
  // Saving happens in the background; only offline (or a broken link) blocks editing.
  const disabled = !online || (!!shareToken && error);
  function addTask(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !taskTitle.trim() || disabled || !canEditTasks) return;
    void run({
      type: "create-todo",
      id: crypto.randomUUID(),
      listId: selected.id,
      title: taskTitle.trim(),
    });
    setTaskTitle("");
    taskInput.current?.focus();
  }
  function saveEditor(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || !editor.value.trim()) return;
    const id = editor.id ?? crypto.randomUUID();
    const value = editor.value.trim();
    const command: Command =
      editor.type === "update-todo"
        ? { type: editor.type, id, title: value }
        : { type: editor.type, id, workspaceId: activeWorkspace!.id, name: value, kind: editor.kind ?? "todo" };
    void run(command);
    setEditor(null);
    if (editor.type === "create-list") void selectList(id);
  }
  const connectionText = !online
    ? t.sync.offline
    : error
      ? t.sync.failed
      : pending
        ? t.sync.saving
        : connection === "connected"
          ? t.sync.synced
          : connection === "connecting"
            ? t.sync.connecting
            : t.sync.polling;
  if (shareToken && unavailable) return <main className="account-content"><Brand /><div className="account-heading"><h1>{t.linkUnavailable.title}</h1><p>{t.linkUnavailable.body}</p></div></main>;
  return (
    <div className={cn("workspace-shell", sidebarCollapsed && "sidebar-collapsed", shareToken && "shared-workspace")}>
      <a href="#tasks" className="skip-link">
        {t.skipToList}
      </a>
      {!shareToken && <aside id="list-sidebar" className="list-sidebar" aria-label={t.sidebar.label} inert={sidebarCollapsed} aria-hidden={sidebarCollapsed}>
        <div className="sidebar-brand-row"><AppSwitcher menu={workspaceMenu.items}><Brand /></AppSwitcher></div>
        <div className="list-navigation sidebar-sections">
          <div className="sidebar-top">
            <ListSpotlight lists={data.lists} selectedId={selected?.id} onSelect={selectList} onOverview={showOverview} />
            <button className={cn("list-link", "dashboard-nav", showDashboard && "is-selected")} aria-current={showDashboard ? "page" : undefined} onClick={showOverview}><Home className="size-4 shrink-0" aria-hidden="true" /><span>{t.sidebar.overview}</span></button>
          </div>
          {(["todo", "note"] as const).map((kind) => {
            const sectionLists = data.lists.filter((list) => (list.kind ?? "todo") === kind);
            const Icon = kind === "note" ? Note : ListTodo;
            return <section className="sidebar-list-section" key={kind} aria-labelledby={`sidebar-${kind}`}>
              <div className="sidebar-heading">
                <h2 id={`sidebar-${kind}`}>{kind === "note" ? t.sidebar.notes : t.sidebar.lists}</h2>
                <Button variant="ghost" size="icon-sm" className="sidebar-add" aria-label={kind === "note" ? t.sidebar.newNote : t.sidebar.newList} title={kind === "note" ? t.sidebar.newNote : t.sidebar.newList} onClick={() => setEditor({ type: "create-list", value: "", kind })} disabled={disabled}><Plus /></Button>
              </div>
              <nav aria-label={kind === "note" ? t.sidebar.notes : t.sidebar.taskLists}>
                <Sortable className="sidebar-section-links" items={sectionLists} label={(list) => list.name} keyboard="content" itemClassName="sidebar-sortable-item" disabled={disabled} onMove={(move) => run({ type: "move-list", ...move })}>
                  {(list) => <button className={cn("list-link", selected?.id === list.id && "is-selected")} onClick={() => selectList(list.id)} aria-current={selected?.id === list.id ? "page" : undefined}>
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{list.name}</span>
                    {kind !== "note" && (() => {
                      // Only show a count when there is something left to do.
                      const open = data.todos.filter((item) => item.listId === list.id && !item.completed).length;
                      return open > 0 && <span className="list-count">{open}</span>;
                    })()}
                  </button>}
                </Sortable>
                {!sectionLists.length && (
                  <button className="list-link is-ghost" onClick={() => setEditor({ type: "create-list", value: "", kind })} disabled={disabled}>
                    <Plus className="size-4 shrink-0" aria-hidden="true" />
                    <span>{kind === "note" ? t.sidebar.newNote : t.sidebar.newList}</span>
                  </button>
                )}
              </nav>
            </section>;
          })}
        </div>
        <UpdateButton />
        {/* Workspace, settings and sign-out live in one menu at the bottom; in the desktop app, in the brand's. */}
        {user && activeWorkspace && onSelectWorkspace && !desktop && (
          <div className="sidebar-footer">
            <WorkspaceSwitcher user={user} active={activeWorkspace} items={workspaceMenu.items} />
          </div>
        )}
        {user && activeWorkspace && onSelectWorkspace && (
          <WorkspaceSettings user={user} workspaces={workspaces} activeWorkspace={activeWorkspace} onSelectWorkspace={onSelectWorkspace} />
        )}
        {workspaceMenu.dialog}
      </aside>}
      <main id="tasks" className="workspace-main" tabIndex={-1}>
      {!shareToken && <Button ref={sidebarExpand} variant="ghost" size="icon" className="sidebar-corner-toggle"
          aria-label={t.sidebar.expand} title={t.sidebar.expandTitle} aria-keyshortcuts="Meta+B Control+B"
          aria-hidden={!sidebarCollapsed} inert={!sidebarCollapsed} tabIndex={sidebarCollapsed ? 0 : -1}
          aria-expanded={false} aria-controls="list-sidebar" onClick={toggleSidebar}>
          <SidebarToggle className="size-5" aria-hidden="true" />
        </Button>}
        <div className="collapsed-brand" aria-hidden={!sidebarCollapsed && !shareToken}>
          {shareToken ? <Brand /> : <AppSwitcher menu={workspaceMenu.items}><Brand /></AppSwitcher>}
        </div>
          <button
            className="sync-status"
            title={t.sync.syncNow}
            onClick={() => void refresh()}
            aria-label={t.sync.syncNowLabel(connectionText)}
          >
            {!online || error ? (
              <CloudOff className="size-4" />
            ) : pending || connection === "connecting" ? (
              <RefreshCw className={cn("size-4", pending && "animate-spin")} />
            ) : (
              <CloudCheck className="size-4" />
            )}
            <span role="status">{connectionText}</span>
          </button>
        <div ref={pageScroller} className={cn("task-content", showDashboard && "dashboard-content scroll-fade", selected?.kind === "note" && "note-content")}>
          {(!online || error) && (
            <Alert>
              <AlertTitle>
                {!online ? t.sync.offlineTitle : t.sync.failedTitle}
              </AlertTitle>
              <AlertDescription>
                {!online ? t.sync.offlineBody : t.sync.failedBody}
              </AlertDescription>
            </Alert>
          )}
          {showDashboard ? <WorkspaceDashboard data={data} name={user?.name ?? ""} workspace={activeWorkspace} onSelect={selectList} onCreate={(kind) => setEditor({ type: "create-list", value: "", kind })} run={run} disabled={disabled} /> : selected ? (
            <>
              <div className="task-heading">
                <div className="min-w-0 flex-1">
                  <InlineName key={selected.id} heading value={selected.name} label={t.list.renameLabel} maxLength={80}
                    disabled={disabled || selected.role !== "owner"}
                    onSave={(name) => run({ type: "rename-list", id: selected.id, name })} />
                  {selected.role === "viewer" && <p>{t.list.readOnly}</p>}
                  {selected.kind !== "note" && <p className="list-summary">
                    <span>{remaining === 0 && items.length > 0
                      ? t.list.allDone
                      : t.list.tasksToDo(remaining)}</span>
                  </p>}
                </div>
                {!shareToken && <div className="flex shrink-0 items-center gap-1">
                {selected.role === "owner" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={selected.kind === "note" ? t.list.shareNote : t.list.shareList}
                    title={selected.kind === "note" ? t.list.shareNote : t.list.shareList}
                    disabled={disabled}
                    onClick={() => setSharingList(selected)}
                  >
                    <Share />
                  </Button>
                )}
                {hasListMenu && <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t.list.options}
                      disabled={disabled}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      {selected.kind === "note" && <DropdownMenuItem onSelect={() => noteDownload.current?.()}><Download aria-hidden="true" />{t.list.downloadMarkdown}</DropdownMenuItem>}
                      {canClearDone && (
                        <DropdownMenuItem onSelect={() => setDeletion({ type: "clear-done", listId: selected.id, count: doneCount })}>
                          <CheckCheck aria-hidden="true" />
                          {t.list.clearDone}
                        </DropdownMenuItem>
                      )}
                      {selected.role === "owner" ? (
                        <>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() =>
                              setDeletion({
                                type: "delete-list",
                                id: selected.id,
                                title: selected.name,
                              })
                            }
                          >
                            <Trash2 />
                            {selected.kind === "note" ? t.list.deleteNote : t.list.deleteList}
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>}
                </div>}
              </div>
              {selected.kind === "note" ? <Suspense fallback={<p className="text-sm text-muted-foreground">{t.list.loadingNote}</p>}><NoteEditor key={selected.id} list={selected} identity={shareToken ?? user!.id} endpoint={listEndpoint} saveRef={noteSave} downloadRef={noteDownload} /></Suspense> : <>
              {canEditTasks && (
                <form className="task-composer" onSubmit={addTask}>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="new-task" className="sr-only">
                        {t.composer.label}
                      </FieldLabel>
                      <InputGroup className="h-12" data-disabled={disabled}>
                        <InputGroupInput
                          ref={taskInput}
                          id="new-task"
                          value={taskTitle}
                          onChange={(e) => setTaskTitle(e.target.value)}
                          maxLength={500}
                          placeholder={t.composer.placeholder}
                          autoComplete="off"
                          disabled={disabled}
                        />
                        <InputGroupAddon align="inline-end" className="has-[>button]:mr-0">
                          <InputGroupButton
                            type="submit"
                            variant="default"
                            size="icon-sm"
                            aria-label={t.composer.addLabel}
                            title={t.composer.addLabel}
                            disabled={disabled || !taskTitle.trim()}
                          >
                            <Plus />
                          </InputGroupButton>
                        </InputGroupAddon>
                      </InputGroup>
                    </Field>
                  </FieldGroup>
                </form>
              )}
              {items.length === 0 ? (
                <Empty className="py-16">
                  <EmptyHeader>
                    <EmptyMedia>
                      <ListTodo className="size-7 text-muted-foreground" />
                    </EmptyMedia>
                    <EmptyTitle>{t.emptyList.title}</EmptyTitle>
                    <EmptyDescription>
                      {canEditTasks ? t.emptyList.canEdit : t.emptyList.readOnly}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <motion.div
                  ref={listScroller}
                  className="todo-list scroll-fade"
                  layoutScroll
                  tabIndex={0}
                  role="list"
                  aria-label={t.list.tasksIn(selected.name)}
                >
                  {(["busy", "open", "done"] as const).map((status) => (
                    <div key={`${selected.id}-${status}`}>
                      {(status !== "open" || items.some((t) => taskStatus(t) === "busy")) && items.some((t) => taskStatus(t) === status) && (
                        <div className="completed-heading">
                          <h2>{t.status[status]} <span>{items.filter((t) => taskStatus(t) === status).length}</span></h2>
                        </div>
                      )}
                      <Sortable items={items.filter((t) => taskStatus(t) === status)} label={(todo) => todo.title} disabled={disabled || !canEditTasks} onMove={(move) => run({ type: "move-todo", ...move })}>
                        {(todo) => (
                          <TodoRow todo={todo} disabled={disabled || !canEditTasks}
                            onRename={(title) => run({ type: "update-todo", id: todo.id, title })}
                            onToggle={() => void run({ type: "update-todo", id: todo.id, completed: !todo.completed && !!todo.inProgress, inProgress: !todo.completed && !todo.inProgress })}
                            onEdit={() => setEditor({ type: "update-todo", id: todo.id, value: todo.title })}
                            onDelete={() => setDeletion({ type: "delete-todo", id: todo.id, title: todo.title })}
                          />
                        )}
                      </Sortable>
                    </div>
                  ))}
                </motion.div>
              )}
              </>}
            </>
          ) : (
            <Empty className="py-20">
              <EmptyHeader>
                <EmptyMedia>
                  <ListTodo className="size-8 text-primary" />
                </EmptyMedia>
                <EmptyTitle>{t.noLists.title}</EmptyTitle>
                <EmptyDescription>
                  {t.noLists.body}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  disabled={disabled}
                  onClick={() => setEditor({ type: "create-list", value: "" })}
                >
                  <Plus data-icon="inline-start" />
                  {t.noLists.create}
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </div>
      </main>
      {sharingList && (
        <ShareListDialog
          list={sharingList}
          workspaceName={activeWorkspace?.name ?? ""}
          onClose={() => setSharingList(null)}
        />
      )}
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editor?.type === "create-list"
                ? editor.kind === "note" ? t.editor.newNote : t.editor.newList
                : t.editor.editTask}
            </DialogTitle>
            <DialogDescription>
              {editor?.type === "update-todo"
                ? t.editor.editTaskDescription
                : editor?.kind === "note" ? t.editor.noteDescription : t.editor.listDescription}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEditor} className="flex flex-col gap-5">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="editor-value">
                  {editor?.type === "update-todo"
                    ? t.editor.task
                    : editor?.kind === "note" ? t.editor.noteTitle : t.editor.listName}
                </FieldLabel>
                <Input
                  id="editor-value"
                  autoFocus
                  value={editor?.value ?? ""}
                  onChange={(e) =>
                    setEditor(
                      editor ? { ...editor, value: e.target.value } : null,
                    )
                  }
                  maxLength={editor?.type === "update-todo" ? 500 : 80}
                  required
                  placeholder={
                    editor?.type === "create-list"
                      ? editor.kind === "note" ? t.editor.notePlaceholder : t.editor.listPlaceholder
                      : undefined
                  }
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditor(null)}
              >
                {t.editor.cancel}
              </Button>
              <Button
                type="submit"
                disabled={disabled || !editor?.value.trim()}
              >
                {editor?.type === "create-list"
                    ? editor.kind === "note" ? t.editor.createNote : t.editor.createList
                    : t.editor.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deletion}
        onOpenChange={(open) => {
          if (!open) setDeletion(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deletion?.type === "clear-done"
                ? t.deletion.doneTitle
                : deletion?.type === "delete-list" ? t.deletion.listTitle : t.deletion.taskTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deletion?.type === "clear-done"
                ? t.deletion.doneBody(deletion.count)
                : t.deletion.body(deletion?.title ?? "", deletion?.type === "delete-list")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.deletion.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disabled}
              onClick={() => {
                if (deletion?.type === "clear-done") void run({ type: "clear-done", listId: deletion.listId });
                else if (deletion) void run({ type: deletion.type, id: deletion.id });
              }}
            >
              {t.deletion.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
function TodoRow({
  todo,
  onRename,
  disabled,
  onToggle,
  onEdit,
  onDelete,
}: {
  todo: Todo;
  onRename: (title: string) => Promise<boolean>;
  disabled: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t: { workspace: t } } = useI18n();
  return (
    <div className={cn("todo-row", todo.completed && "is-complete")}>
      <Checkbox
        id={`task-${todo.id}`}
        checked={todo.completed ? true : todo.inProgress ? "indeterminate" : false}
        onCheckedChange={onToggle}
        disabled={disabled}
        aria-label={t.task.checkboxLabel(todo.title, todo.completed ? "done" : todo.inProgress ? "busy" : "open")}
      />
      <InlineName value={todo.title} label={t.task.renameLabel} maxLength={500} disabled={disabled}
        className="todo-title" onSave={onRename} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="task-menu"
            disabled={disabled}
            aria-label={t.task.optionsFor(todo.title)}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              {t.task.edit}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 />
              {t.task.delete}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
