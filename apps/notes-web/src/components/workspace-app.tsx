import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Download,
  Note,
  Home,
  SidebarToggle,
  CloudCheck,
  CloudOff,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Share,
  Trash2,
} from "@/components/icons";
import { ListSpotlight } from "@/components/list-spotlight";
import { WorkspaceSettings } from "@/components/settings/workspace-settings";
import { useWorkspaceMenu, WorkspaceSwitcher } from "@/components/workspace-switcher";
import type { WorkspaceSummary } from "@evido/todo-core/workspaces";
import type { WorkspaceData, TodoList } from "@evido/todo-core/workspace";
import { InlineName } from "@/components/inline-name";
import { WorkspaceDashboard } from "@/components/workspace-dashboard";
import { Sortable } from "@/components/sortable";
import { ShareListDialog } from "@/components/share-list-dialog";
import { useWorkspace } from "@/hooks/use-workspace";
import { useI18n } from "@/i18n";
import { cn } from "@evido/ui/lib/utils";
import { useCollapsibleSidebar } from "@evido/ui/hooks/use-collapsible-sidebar";
import { useScrollFade } from "@evido/ui/hooks/use-scroll-fade";
import { Brand } from "@/components/brand";
import { Button } from "@evido/ui/components/button";
import { Input } from "@evido/ui/components/input";
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
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia, EmptyContent } from "@evido/ui/components/empty";
import { Alert, AlertTitle, AlertDescription } from "@evido/ui/components/alert";

const NoteEditor = lazy(() => import("@/components/note-editor"));

/**
 * Even noteren: the notes of a workspace. Notes are the workspace's lists of
 * kind "note", the same ones Even doen used to show; its task lists and boards
 * stay there.
 */
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
  // Workspaces, settings and sign-out: the footer menu; in the desktop app only workspaces, as the rail opens settings.
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
  const notes = data.lists.filter((list) => list.kind === "note");
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const selectedId = searchParams.get("note");
  const [creating, setCreating] = useState<string | null>(null);
  const [deletion, setDeletion] = useState<{ id: string; title: string } | null>(null);
  const [sharingNote, setSharingNote] = useState<TodoList | null>(null);
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar, expandButton: sidebarExpand } = useCollapsibleSidebar({ enabled: !shareToken });
  const pageScroller = useScrollFade<HTMLDivElement>();
  const noteDownload = useRef<(() => void) | null>(null);
  const noteSave = useRef<(() => Promise<boolean>) | null>(null);
  const showDashboard = !shareToken && !selectedId;
  const selected = showDashboard ? undefined : notes.find((l) => l.id === selectedId) ?? notes[0];
  async function showOverview() {
    if (noteSave.current && !(await noteSave.current())) return;
    const next = new URLSearchParams(window.location.search);
    next.delete("note");
    navigate({ search: next.toString() });
  }
  const activeNoteId = selected?.id;
  async function selectNote(id: string) {
    if (noteSave.current && !(await noteSave.current())) return;
    const next = new URLSearchParams(window.location.search);
    if (next.get("note") !== id) {
      next.set("note", id);
      navigate({ search: next.toString() });
    }
  }
  useEffect(() => {
    // Wait for mutations to settle before replacing a missing/deleted selection.
    if (pending || selectedId === (activeNoteId ?? null)) return;
    const url = new URL(window.location.href);
    if (url.pathname !== "/" || url.searchParams.get("note") !== selectedId) return;
    if (activeNoteId) url.searchParams.set("note", activeNoteId);
    else url.searchParams.delete("note");
    navigate({ search: url.searchParams.toString() }, { replace: true });
  }, [activeNoteId, selectedId, pending, navigate]);
  useEffect(() => {
    document.title = selected?.name ? t.pageTitle(selected.name) : t.overviewTitle;
  }, [selected?.name, t]);
  // Saving happens in the background; only offline (or a broken link) blocks editing.
  const disabled = !online || (!!shareToken && error);
  function createNote(event: React.FormEvent) {
    event.preventDefault();
    const name = creating?.trim();
    if (!name || !activeWorkspace) return;
    const id = crypto.randomUUID();
    void run({ type: "create-list", id, workspaceId: activeWorkspace.id, name, kind: "note" });
    setCreating(null);
    void selectNote(id);
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
      <a href="#notes" className="skip-link">
        {t.skipToNote}
      </a>
      {!shareToken && <aside id="list-sidebar" className="list-sidebar" aria-label={t.sidebar.label} inert={sidebarCollapsed} aria-hidden={sidebarCollapsed}>
        <div className="sidebar-brand-row"><Brand /></div>
        <div className="list-navigation sidebar-sections">
          <div className="sidebar-top">
            <ListSpotlight notes={notes} selectedId={selected?.id} onSelect={selectNote} onOverview={showOverview} />
            <button className={cn("list-link", "dashboard-nav", showDashboard && "is-selected")} aria-current={showDashboard ? "page" : undefined} onClick={showOverview}><Home className="size-4 shrink-0" aria-hidden="true" /><span>{t.sidebar.overview}</span></button>
          </div>
          <section className="sidebar-list-section" aria-labelledby="sidebar-notes">
            <div className="sidebar-heading">
              <h2 id="sidebar-notes">{t.sidebar.notes}</h2>
              <Button variant="ghost" size="icon-sm" className="sidebar-add" aria-label={t.sidebar.newNote} title={t.sidebar.newNote} onClick={() => setCreating("")} disabled={disabled}><Plus /></Button>
            </div>
            <nav aria-label={t.sidebar.notes}>
              <Sortable className="sidebar-section-links" items={notes} label={(note) => note.name} keyboard="content" itemClassName="sidebar-sortable-item" disabled={disabled} onMove={(move) => run({ type: "move-list", ...move })}>
                {(note) => <button className={cn("list-link", selected?.id === note.id && "is-selected")} onClick={() => selectNote(note.id)} aria-current={selected?.id === note.id ? "page" : undefined}>
                  <Note className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{note.name}</span>
                </button>}
              </Sortable>
              {!notes.length && (
                <button className="list-link is-ghost" onClick={() => setCreating("")} disabled={disabled}>
                  <Plus className="size-4 shrink-0" aria-hidden="true" />
                  <span>{t.sidebar.newNote}</span>
                </button>
              )}
            </nav>
          </section>
        </div>
        {/* Workspace, settings and sign-out live in one menu at the bottom; in the desktop app only the workspaces. */}
        {user && activeWorkspace && onSelectWorkspace && (
          <div className="sidebar-footer">
            <WorkspaceSwitcher user={user} active={activeWorkspace} items={workspaceMenu.items} />
          </div>
        )}
        {user && activeWorkspace && onSelectWorkspace && (
          <WorkspaceSettings user={user} workspaces={workspaces} activeWorkspace={activeWorkspace} onSelectWorkspace={onSelectWorkspace} />
        )}
        {workspaceMenu.dialog}
      </aside>}
      <main id="notes" className="workspace-main" tabIndex={-1}>
      {!shareToken && <Button ref={sidebarExpand} variant="ghost" size="icon" className="sidebar-corner-toggle"
          aria-label={t.sidebar.expand} title={t.sidebar.expandTitle} aria-keyshortcuts="Meta+B Control+B"
          aria-hidden={!sidebarCollapsed} inert={!sidebarCollapsed} tabIndex={sidebarCollapsed ? 0 : -1}
          aria-expanded={false} aria-controls="list-sidebar" onClick={toggleSidebar}>
          <SidebarToggle className="size-5" aria-hidden="true" />
        </Button>}
        <div className="collapsed-brand" aria-hidden={!sidebarCollapsed && !shareToken}>
          <Brand />
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
        <div ref={pageScroller} className={cn("task-content", showDashboard ? "dashboard-content scroll-fade" : "note-content")}>
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
          {showDashboard ? <WorkspaceDashboard notes={notes} name={user?.name ?? ""} onSelect={selectNote} onCreate={() => setCreating("")} disabled={disabled} /> : selected ? (
            <>
              <div className="task-heading">
                <div className="min-w-0 flex-1">
                  <InlineName key={selected.id} heading value={selected.name} label={t.note.renameLabel} maxLength={80}
                    disabled={disabled || selected.role !== "owner"}
                    onSave={(name) => run({ type: "rename-list", id: selected.id, name })} />
                  {selected.role === "viewer" && <p>{t.note.readOnly}</p>}
                </div>
                {!shareToken && <div className="flex shrink-0 items-center gap-1">
                {selected.role === "owner" && (
                  <Button variant="ghost" size="icon" aria-label={t.note.share} title={t.note.share} disabled={disabled} onClick={() => setSharingNote(selected)}>
                    <Share />
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={t.note.options} disabled={disabled}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onSelect={() => noteDownload.current?.()}><Download aria-hidden="true" />{t.note.downloadMarkdown}</DropdownMenuItem>
                      {selected.role === "owner" && (
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeletion({ id: selected.id, title: selected.name })}>
                          <Trash2 />
                          {t.note.delete}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                </div>}
              </div>
              <Suspense fallback={<p className="text-sm text-muted-foreground">{t.note.loading}</p>}><NoteEditor key={selected.id} list={selected} identity={shareToken ?? user!.id} endpoint={listEndpoint} saveRef={noteSave} downloadRef={noteDownload} /></Suspense>
            </>
          ) : (
            <Empty className="py-20">
              <EmptyHeader>
                <EmptyMedia>
                  <Note className="size-8 text-primary" />
                </EmptyMedia>
                <EmptyTitle>{t.noNotes.title}</EmptyTitle>
                <EmptyDescription>{t.noNotes.body}</EmptyDescription>
              </EmptyHeader>
              {!shareToken && <EmptyContent>
                <Button disabled={disabled} onClick={() => setCreating("")}>
                  <Plus data-icon="inline-start" />
                  {t.noNotes.create}
                </Button>
              </EmptyContent>}
            </Empty>
          )}
        </div>
      </main>
      {sharingNote && (
        <ShareListDialog
          list={sharingNote}
          workspaceName={activeWorkspace?.name ?? ""}
          onClose={() => setSharingNote(null)}
        />
      )}
      <Dialog open={creating !== null} onOpenChange={(open) => { if (!open) setCreating(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.editor.newNote}</DialogTitle>
            <DialogDescription>{t.editor.noteDescription}</DialogDescription>
          </DialogHeader>
          <form onSubmit={createNote} className="flex flex-col gap-5">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="note-title">{t.editor.noteTitle}</FieldLabel>
                <Input
                  id="note-title"
                  autoFocus
                  value={creating ?? ""}
                  onChange={(e) => setCreating(e.target.value)}
                  maxLength={80}
                  required
                  placeholder={t.editor.notePlaceholder}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(null)}>
                {t.editor.cancel}
              </Button>
              <Button type="submit" disabled={disabled || !creating?.trim()}>
                {t.editor.createNote}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deletion} onOpenChange={(open) => { if (!open) setDeletion(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deletion.title}</AlertDialogTitle>
            <AlertDialogDescription>{t.deletion.body(deletion?.title ?? "")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.deletion.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disabled}
              onClick={() => {
                if (deletion) void run({ type: "delete-list", id: deletion.id });
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
