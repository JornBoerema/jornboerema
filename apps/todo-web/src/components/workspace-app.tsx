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
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
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
import { cn } from "@evido/ui/lib/utils";
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
  type: "create-list" | "rename-list" | "update-todo";
  id?: string;
  value: string;
  kind?: "todo" | "note";
};
type Deletion = {
  type: "delete-list" | "delete-todo";
  id: string;
  title: string;
};
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
  const { data, run, pending, online, connection, error, refresh, unavailable } =
    useWorkspace(user?.id ?? "guest", activeWorkspace?.id ?? "", initialData, realtimeEnabled, shareToken);
  const listEndpoint = shareToken
    ? `/api/gedeeld/${shareToken}`
    : `/api/workspace?workspaceId=${encodeURIComponent(activeWorkspace?.id ?? "")}`;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const selectedId = searchParams.get("lijst");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deletion, setDeletion] = useState<Deletion | null>(null);
  const [sharingList, setSharingList] = useState<TodoList | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarExpand = useRef<HTMLButtonElement>(null);
  const sidebarFocusPending = useRef(false);
  function toggleSidebar() {
    sidebarFocusPending.current = true;
    setSidebarCollapsed((value) => !value);
  }
  useEffect(() => {
    if (!sidebarFocusPending.current) return;
    let cancelled = false;
    // Collapsing focuses the corner toggle; expanding returns to the sidebar.
    const button = sidebarCollapsed
      ? sidebarExpand.current
      : document.querySelector<HTMLButtonElement>("#list-sidebar .workspace-switcher");
    const frame = requestAnimationFrame(async () => {
      if (!button) return;
      await Promise.allSettled(button.getAnimations().map((animation) => animation.finished));
      if (!cancelled) {
        button.focus();
        sidebarFocusPending.current = false;
      }
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [sidebarCollapsed]);
  useEffect(() => {
    if (shareToken) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "b" || event.altKey || event.shiftKey || event.repeat || event.isComposing) return;
      // Keep rich-text shortcuts and modal focus within their own editors/dialogs.
      if (event.target instanceof HTMLElement && event.target.isContentEditable) return;
      if (document.querySelector('[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"]), [role="menu"]:not([data-state="closed"])')) return;
      event.preventDefault();
      sidebarFocusPending.current = !!document.activeElement?.closest("#list-sidebar") || document.activeElement === sidebarExpand.current;
      setSidebarCollapsed((value) => !value);
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [shareToken]);
  const taskInput = useRef<HTMLInputElement>(null);
  const noteDownload = useRef<(() => void) | null>(null);
  const noteSave = useRef<(() => Promise<boolean>) | null>(null);
  const showDashboard = !shareToken && !selectedId;
  const selected = showDashboard ? undefined : data.lists.find((l) => l.id === selectedId) ?? data.lists[0];
  async function showOverview() {
    if (noteSave.current && !(await noteSave.current())) return;
    const next = new URLSearchParams(window.location.search);
    next.delete("lijst");
    navigate({ search: next.toString() });
    setTaskTitle("");
  }
  const activeListId = selected?.id;
  async function selectList(id: string) {
    if (noteSave.current && !(await noteSave.current())) return;
    const next = new URLSearchParams(window.location.search);
    if (next.get("lijst") !== id) {
      next.set("lijst", id);
      navigate({ search: next.toString() });
    }
    setTaskTitle("");
  }
  useEffect(() => {
    // Wait for mutations to settle before replacing a missing/deleted selection.
    if (pending || selectedId === (activeListId ?? null)) return;
    const url = new URL(window.location.href);
    if (url.pathname !== "/" || url.searchParams.get("lijst") !== selectedId) return;
    if (activeListId) url.searchParams.set("lijst", activeListId);
    else url.searchParams.delete("lijst");
    navigate({ search: url.searchParams.toString() }, { replace: true });
  }, [activeListId, selectedId, pending, navigate]);
  useEffect(() => {
    document.title = selected?.name ? `${selected.name} · Even doen` : "Overzicht · Even doen";
  }, [selected?.name]);
  const items = sortTodos(data.todos.filter((t) => t.listId === selected?.id));
  const canEditTasks = selected?.role !== "viewer";
  const remaining = items.filter((t) => !t.completed).length;
  const disabled = pending || !online || (!!shareToken && error);
  async function addTask(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !taskTitle.trim() || disabled || !canEditTasks) return;
    const title = taskTitle.trim();
    const success = await run({
      type: "create-todo",
      id: crypto.randomUUID(),
      listId: selected.id,
      title,
    });
    if (success) setTaskTitle("");
    requestAnimationFrame(() => taskInput.current?.focus());
  }
  async function saveEditor(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || !editor.value.trim()) return;
    const id = editor.id ?? crypto.randomUUID();
    const value = editor.value.trim();
    const command: Command =
      editor.type === "update-todo"
        ? { type: editor.type, id, title: value }
        : editor.type === "create-list"
          ? { type: editor.type, id, workspaceId: activeWorkspace!.id, name: value, kind: editor.kind ?? "todo" }
          : { type: editor.type, id, name: value };
    if (await run(command)) {
      if (editor.type === "create-list") selectList(id);
      setEditor(null);
    }
  }
  const connectionText = !online
    ? "Offline"
    : error
      ? "Synchroniseren mislukt"
      : pending
        ? "Opslaan…"
        : connection === "connected"
          ? "Gesynchroniseerd"
          : connection === "connecting"
            ? "Verbinden…"
            : "Periodiek gesynchroniseerd";
  if (shareToken && unavailable) return <main className="account-content"><Brand /><div className="account-heading"><h1>Deze link is niet meer beschikbaar</h1><p>Vraag de eigenaar om een nieuwe link naar de lijst.</p></div></main>;
  return (
    <div className={cn("workspace-shell", sidebarCollapsed && "sidebar-collapsed", shareToken && "shared-workspace")}>
      <a href="#taken" className="skip-link">
        Ga naar de lijst
      </a>
      {!shareToken && <aside id="list-sidebar" className="list-sidebar" aria-label="Lijsten" inert={sidebarCollapsed} aria-hidden={sidebarCollapsed}>
        <Brand />
        <div className="list-navigation sidebar-sections">
          <ListSpotlight lists={data.lists} selectedId={selected?.id} onSelect={selectList} onOverview={showOverview} />
          <button className={cn("list-link", "dashboard-nav", showDashboard && "is-selected")} aria-current={showDashboard ? "page" : undefined} onClick={showOverview}><Home className="size-4 shrink-0" aria-hidden="true" /><span>Overzicht</span></button>
          {(["todo", "note"] as const).map((kind) => {
            const sectionLists = data.lists.filter((list) => (list.kind ?? "todo") === kind);
            const Icon = kind === "note" ? Note : ListTodo;
            return <section className="sidebar-list-section" key={kind} aria-labelledby={`sidebar-${kind}`}>
              <div className="sidebar-heading">
                <h2 id={`sidebar-${kind}`}>{kind === "note" ? "Notities" : "Lijsten"}</h2>
                <Button variant="ghost" size="icon" aria-label={kind === "note" ? "Nieuwe notitie" : "Nieuwe lijst"} onClick={() => setEditor({ type: "create-list", value: "", kind })} disabled={disabled}><Plus /></Button>
              </div>
              <nav aria-label={kind === "note" ? "Notities" : "Takenlijsten"}>
                <Sortable className="sidebar-section-links" items={sectionLists} label={(list) => list.name} keyboard="content" itemClassName="sidebar-sortable-item" disabled={disabled} onMove={(move) => run({ type: "move-list", ...move })}>
                  {(list) => <button className={cn("list-link", selected?.id === list.id && "is-selected")} onClick={() => selectList(list.id)} aria-current={selected?.id === list.id ? "page" : undefined}>
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{list.name}</span>
                    {kind !== "note" && <span className="list-count">{data.todos.filter((item) => item.listId === list.id && !item.completed).length}</span>}
                  </button>}
                </Sortable>
                {!sectionLists.length && <p className="sidebar-note">{kind === "note" ? "Nog geen notities." : "Nog geen lijsten."}</p>}
              </nav>
            </section>;
          })}
        </div>
        {/* Workspace, settings and sign-out live in one menu at the bottom. */}
        {user && activeWorkspace && onSelectWorkspace && (
          <div className="sidebar-footer">
            <WorkspaceSwitcher user={user} workspaces={workspaces} active={activeWorkspace} onSelect={onSelectWorkspace} />
            <WorkspaceSettings user={user} workspaces={workspaces} activeWorkspace={activeWorkspace} onSelectWorkspace={onSelectWorkspace} />
          </div>
        )}
      </aside>}
      <main id="taken" className="workspace-main" tabIndex={-1}>
      {!shareToken && <Button ref={sidebarExpand} variant="ghost" size="icon" className="sidebar-corner-toggle"
          aria-label="Sidebar uitklappen" title="Sidebar uitklappen (⌘/Ctrl+B)" aria-keyshortcuts="Meta+B Control+B"
          aria-hidden={!sidebarCollapsed} inert={!sidebarCollapsed} tabIndex={sidebarCollapsed ? 0 : -1}
          aria-expanded={false} aria-controls="list-sidebar" onClick={toggleSidebar}>
          <SidebarToggle className="size-5" aria-hidden="true" />
        </Button>}
        <div className="collapsed-brand" aria-hidden={!sidebarCollapsed && !shareToken}>
          <Brand />
        </div>
          <button
            className="sync-status"
            title="Nu synchroniseren"
            onClick={() => void refresh()}
            aria-label={`${connectionText}. Nu synchroniseren.`}
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
        <div className={cn("task-content", showDashboard && "dashboard-content", selected?.kind === "note" && "note-content")}>
          {(!online || error) && (
            <Alert>
              <AlertTitle>
                {!online ? "Je bent offline" : "Synchroniseren is niet gelukt"}
              </AlertTitle>
              <AlertDescription>
                {!online
                  ? "Je kunt je lijsten bekijken. Zodra je weer verbinding hebt, kun je verder."
                  : "Je ziet de laatst geladen lijsten. Probeer opnieuw te synchroniseren."}
              </AlertDescription>
            </Alert>
          )}
          {showDashboard ? <WorkspaceDashboard data={data} name={user?.name ?? ""} onSelect={selectList} onCreate={(kind) => setEditor({ type: "create-list", value: "", kind })} disabled={disabled} /> : selected ? (
            <>
              <div className="task-heading">
                <div className="min-w-0 flex-1">
                  <InlineName key={selected.id} heading value={selected.name} label="Lijstnaam bewerken" maxLength={80}
                    disabled={disabled || selected.role !== "owner"}
                    onSave={(name) => run({ type: "rename-list", id: selected.id, name })} />
                  {selected.role === "viewer" && <p>Alleen lezen</p>}
                  {selected.kind !== "note" && <p className="list-summary">
                    <span>{remaining === 0 && items.length > 0
                      ? "Alles afgevinkt. Lekker gedaan."
                      : `${remaining} ${remaining === 1 ? "taak" : "taken"} te doen`}</span>
                  </p>}
                </div>
                {!shareToken && <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Lijstopties"
                      disabled={disabled}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      {selected.kind === "note" && <DropdownMenuItem onSelect={() => noteDownload.current?.()}><Download aria-hidden="true" />Download .md</DropdownMenuItem>}
                      {selected.role === "owner" ? (
                        <>
                          <DropdownMenuItem
                            onSelect={() => setSharingList(selected)}
                          >
                            <Share aria-hidden="true" />
                            {selected.kind === "note" ? "Notitie delen" : "Lijst delen"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              setEditor({
                                type: "rename-list",
                                id: selected.id,
                                value: selected.name,
                              })
                            }
                          >
                            <Pencil />
                            Naam wijzigen
                          </DropdownMenuItem>
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
                            {selected.kind === "note" ? "Notitie verwijderen" : "Lijst verwijderen"}
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>}
              </div>
              {selected.kind === "note" ? <Suspense fallback={<p className="text-sm text-muted-foreground">Notitie laden…</p>}><NoteEditor key={selected.id} list={selected} identity={shareToken ?? user!.id} endpoint={listEndpoint} saveRef={noteSave} downloadRef={noteDownload} /></Suspense> : <>
              {canEditTasks && (
                <form className="task-composer" onSubmit={addTask}>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="new-task" className="sr-only">
                        Nieuwe taak
                      </FieldLabel>
                      <InputGroup className="h-12" data-disabled={disabled}>
                        <InputGroupInput
                          ref={taskInput}
                          id="new-task"
                          value={taskTitle}
                          onChange={(e) => setTaskTitle(e.target.value)}
                          maxLength={500}
                          placeholder="Wat wil je doen?"
                          autoComplete="off"
                          disabled={disabled}
                        />
                        <InputGroupAddon align="inline-end" className="has-[>button]:mr-0">
                          <InputGroupButton
                            type="submit"
                            variant="default"
                            size="sm"
                            aria-label="Taak toevoegen"
                            disabled={disabled || !taskTitle.trim()}
                          >
                            <Plus data-icon="inline-start" />
                            <span>Toevoegen</span>
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
                    <EmptyTitle>Een lege lijst, een frisse start</EmptyTitle>
                    <EmptyDescription>
                      {canEditTasks
                        ? "Voeg hierboven je eerste taak toe."
                        : "Deze lijst heeft nog geen taken."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <motion.div
                  className="todo-list"
                  layoutScroll
                  tabIndex={0}
                  role="list"
                  aria-label={`Taken in ${selected.name}`}
                >
                  {(["busy", "open", "done"] as const).map((status) => (
                    <div key={`${selected.id}-${status}`}>
                      {(status !== "open" || items.some((t) => taskStatus(t) === "busy")) && items.some((t) => taskStatus(t) === status) && (
                        <div className="completed-heading">
                          <h2>{status === "busy" ? "Mee bezig" : status === "open" ? "Te doen" : "Klaar"} <span>{items.filter((t) => taskStatus(t) === status).length}</span></h2>
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
                <EmptyTitle>Begin met je eerste lijst</EmptyTitle>
                <EmptyDescription>
                  Voor werk, thuis of alles wat je nog wilt doen.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  disabled={disabled}
                  onClick={() => setEditor({ type: "create-list", value: "" })}
                >
                  <Plus data-icon="inline-start" />
                  Nieuwe lijst maken
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
          if (!open && !pending) setEditor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editor?.type === "create-list"
                ? editor.kind === "note" ? "Nieuwe notitie" : "Nieuwe lijst"
                : editor?.type === "rename-list"
                  ? "Naam wijzigen"
                  : "Taak bewerken"}
            </DialogTitle>
            <DialogDescription>
              {editor?.type === "update-todo"
                ? "Pas de tekst van je taak aan."
                : editor?.kind === "note" ? "Geef je notitie een herkenbare titel." : "Geef je lijst een herkenbare naam."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEditor} className="flex flex-col gap-5">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="editor-value">
                  {editor?.type === "update-todo"
                    ? "Taak"
                    : editor?.kind === "note" ? "Titel van de notitie" : "Naam van de lijst"}
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
                  disabled={pending}
                  placeholder={
                    editor?.type === "create-list"
                      ? editor.kind === "note" ? "Bijvoorbeeld: Ideeën" : "Bijvoorbeeld: Werk"
                      : undefined
                  }
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setEditor(null)}
              >
                Annuleren
              </Button>
              <Button
                type="submit"
                disabled={disabled || !editor?.value.trim()}
              >
                {pending
                  ? "Opslaan…"
                  : editor?.type === "create-list"
                    ? editor.kind === "note" ? "Notitie maken" : "Lijst maken"
                    : "Opslaan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deletion}
        onOpenChange={(open) => {
          if (!open && !pending) setDeletion(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deletion?.type === "delete-list"
                ? "Lijst verwijderen?"
                : "Taak verwijderen?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              “{deletion?.title}” wordt verwijderd
              {deletion?.type === "delete-list"
                ? ", samen met alle taken in deze lijst"
                : ""}
              . Dit kun je niet ongedaan maken.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disabled}
              onClick={async (e) => {
                e.preventDefault();
                if (
                  deletion &&
                  (await run({ type: deletion.type, id: deletion.id }))
                )
                  setDeletion(null);
              }}
            >
              {pending ? "Verwijderen…" : "Verwijderen"}
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
  return (
    <div className={cn("todo-row", todo.completed && "is-complete")}>
      <Checkbox
        id={`task-${todo.id}`}
        checked={todo.completed ? true : todo.inProgress ? "indeterminate" : false}
        onCheckedChange={onToggle}
        disabled={disabled}
        aria-label={`${todo.title}: ${todo.completed ? "terug naar te doen" : todo.inProgress ? "klaar maken" : "mee bezig starten"}`}
      />
      <InlineName value={todo.title} label="Taaknaam bewerken" maxLength={500} disabled={disabled}
        className="todo-title" onSave={onRename} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="task-menu"
            disabled={disabled}
            aria-label={`Opties voor ${todo.title}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              Bewerken
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 />
              Verwijderen
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
