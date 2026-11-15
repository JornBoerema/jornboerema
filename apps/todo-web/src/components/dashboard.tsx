import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppSwitcher } from "@evido/ui/components/app-switcher";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@evido/ui/components/avatar";
import { Button } from "@evido/ui/components/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@evido/ui/components/card";
import { Checkbox } from "@evido/ui/components/checkbox";
import { useDesktopSettings } from "@evido/ui/components/desktop-settings";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@evido/ui/components/empty";
import { Progress } from "@evido/ui/components/progress";
import { Skeleton } from "@evido/ui/components/skeleton";
import { sortTodos, type Todo, type WorkspaceData } from "@evido/todo-core/workspace";
import { canManageWorkspace, type WorkspaceSummary } from "@evido/todo-core/workspaces";
import { UserAdd } from "@/components/icons";
import { PageError } from "@/components/page-error";
import { PageLoading } from "@/components/page-loading";
import { useWorkspace } from "@/hooks/use-workspace";
import { apiFetch } from "@/lib/api";
import { RequireSession, type SessionUser } from "@/lib/session";
import { useWorkspaceMembers } from "@/lib/workspaces";
import { useOrganizations } from "@evido/ui/components/organizations";
import { useI18n } from "@/i18n";

const MAX_AVATARS = 5;
const MAX_NOTES = 6;
const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";

/** First meaningful lines of a note, without Markdown and without repeating its title. */
function excerpt(markdown: string, title: string) {
  const plain = (line: string) =>
    line.trim().replace(/^(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s+|\d+\.\s+)/, "").replace(/[*_`~]/g, "").trim();
  const same = (line: string) => line.toLocaleLowerCase() === title.trim().toLocaleLowerCase();
  return markdown.split("\n").map(plain).filter((line) => line && !same(line)).slice(0, 4).join(" ");
}

async function getJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * The dashboard at the head of the Even rail: a look across the apps for the
 * active workspace. What it shows opens in the app it belongs to.
 */
export function DashboardPage() {
  return <RequireSession>{(user) => <Workspaces user={user} />}</RequireSession>;
}

/** The organization picked in the rail; the dashboard only lives in the Even shell. */
function Workspaces({ user }: { user: SessionUser }) {
  const organizations = useOrganizations();
  if (!organizations) return <PageLoading />;
  return <ActiveWorkspace user={user} active={organizations.active} />;
}

function ActiveWorkspace({ user, active }: { user: SessionUser; active: WorkspaceSummary }) {
  const workspace = useQuery({
    queryKey: ["workspace", user.id, active.id],
    queryFn: () => getJson<WorkspaceData>(`/api/workspace?workspaceId=${encodeURIComponent(active.id)}`),
  });
  const config = useQuery({
    queryKey: ["api-config"],
    queryFn: () => getJson<{ realtime: boolean }>("/api/config"),
    staleTime: Infinity,
  });
  if (workspace.isError) return <PageError onRetry={() => void workspace.refetch()} />;
  if (!workspace.data || config.isPending) return <PageLoading />;
  return (
    <Dashboard
      key={active.id}
      user={user}
      workspace={active}
      initialData={workspace.data}
      realtimeEnabled={!!config.data?.realtime}
    />
  );
}

function Dashboard({ user, workspace, initialData, realtimeEnabled }: {
  user: SessionUser; workspace: WorkspaceSummary; initialData: WorkspaceData; realtimeEnabled: boolean;
}) {
  const { t: { workspace: wt }, locale } = useI18n();
  const t = wt.dashboard;
  const { data, run, online } = useWorkspace(user.id, workspace.id, initialData, realtimeEnabled);
  const switcher = useAppSwitcher();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 60000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (switcher?.active === "dashboard") document.title = `${t.title} · Even`;
  }, [switcher?.active, t.title]);
  const hour = now?.getHours();
  const greeting = hour === undefined ? t.welcome : hour < 12 ? t.morning : hour < 18 ? t.afternoon : t.evening;
  const firstName = user.name.trim().split(/\s+/)[0];

  // A list opens in Even doen, a note in Even noteren, in this workspace.
  const inWorkspace = (key: string, id?: string) => {
    const query = new URLSearchParams({ workspace: workspace.id });
    if (id) query.set(key, id);
    return `/?${query}`;
  };
  const openList = (id?: string) => switcher?.open?.("todo", inWorkspace("list", id));
  const openNote = (id?: string) => switcher?.open?.("notes", inWorkspace("note", id));

  const taskLists = data.lists.filter((list) => (list.kind ?? "todo") === "todo");
  const notes = data.lists.filter((list) => list.kind === "note");
  const listIds = new Set(taskLists.map((list) => list.id));
  const tasks = data.todos.filter((item) => listIds.has(item.listId));
  const open = tasks.filter((item) => !item.completed);
  const busy = sortTodos(open.filter((item) => item.inProgress));
  const done = tasks.length - open.length;
  const listName = (id: string) => data.lists.find((list) => list.id === id)?.name ?? "";
  const disabled = !online;

  // Same cycle as in a list: to do → in progress → done.
  const toggle = (todo: Todo) =>
    void run({ type: "update-todo", id: todo.id, completed: !todo.completed && !!todo.inProgress, inProgress: !todo.completed && !todo.inProgress });

  const stats = [
    { label: t.stats.open, value: open.length },
    { label: t.stats.inProgress, value: busy.length },
    { label: t.stats.done, value: done },
    { label: t.stats.notes, value: notes.length },
  ];

  return <main className="workspace-main dashboard-page">
    <div className="task-content dashboard-content scroll-fade">
      <div className="dashboard">
        <div className="task-heading">
          <div className="min-w-0 flex-1">
            <h1>{greeting}{firstName ? `, ${firstName}` : ""}.</h1>
            <p>{now && new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(now)}</p>
          </div>
        </div>

        {!data.lists.length ? <Empty className="py-10">
          <EmptyHeader><EmptyTitle>{t.emptyTitle}</EmptyTitle><EmptyDescription>{t.emptyBody}</EmptyDescription></EmptyHeader>
          <EmptyContent><div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => openList()}>{t.openTodo}</Button>
            <Button variant="outline" onClick={() => openNote()}>{t.openNotes}</Button>
          </div></EmptyContent>
        </Empty> : <div className="widgets">
          <dl className="widget-stats" aria-label={t.stats.label}>
            {stats.map((stat) => (
              <Card key={stat.label} size="sm" className="widget-stat">
                <CardContent className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                  <dd className="text-2xl font-semibold tabular-nums">{stat.value}</dd>
                </CardContent>
              </Card>
            ))}
          </dl>

          <Card size="sm" className="widget">
            <CardHeader><CardTitle>{t.inProgress}</CardTitle></CardHeader>
            <CardContent>
              {busy.length ? <ul className="flex flex-col">
                {busy.map((todo) => (
                  <li key={todo.id} className="widget-task">
                    <Checkbox
                      checked="indeterminate"
                      onCheckedChange={() => toggle(todo)}
                      disabled={disabled}
                      aria-label={wt.task.checkboxLabel(todo.title, "busy")}
                    />
                    <button type="button" className="widget-task-body" onClick={() => openList(todo.listId)}>
                      <span className="truncate">{todo.title}</span>
                      <span className="truncate text-xs text-muted-foreground">{listName(todo.listId)}</span>
                    </button>
                  </li>
                ))}
              </ul> : <p className="widget-empty">{t.inProgressEmpty}</p>}
            </CardContent>
          </Card>

          <Card size="sm" className="widget">
            <CardHeader><CardTitle>{t.progress}</CardTitle></CardHeader>
            <CardContent>
              {tasks.length ? <ul className="flex flex-col gap-1">
                {taskLists.filter((list) => tasks.some((item) => item.listId === list.id)).map((list) => {
                  const items = tasks.filter((item) => item.listId === list.id);
                  const finished = items.filter((item) => item.completed).length;
                  return <li key={list.id}>
                    <button type="button" className="widget-progress-row" onClick={() => openList(list.id)}>
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate">{list.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t.progressCount(finished, items.length)}</span>
                      </span>
                      <Progress value={items.length ? (finished / items.length) * 100 : 0} aria-label={t.progressLabel(list.name, finished, items.length)} />
                    </button>
                  </li>;
                })}
              </ul> : <p className="widget-empty">{t.progressEmpty}</p>}
            </CardContent>
          </Card>

          <section className="widget-notes" aria-labelledby="dashboard-notes">
            <div className="widget-notes-heading">
              <h2 id="dashboard-notes">{t.notes}</h2>
              <Button variant="ghost" size="sm" onClick={() => openNote()}>{t.openNotes}</Button>
            </div>
            {notes.length ? <ul className="note-grid">
              {notes.slice(0, MAX_NOTES).map((note) => (
                <li key={note.id}>
                  <button type="button" className="note-card" onClick={() => openNote(note.id)}>
                    <span className="note-card-title">{note.name}</span>
                    <span className="note-card-excerpt">{excerpt(note.note?.markdown ?? "", note.name) || t.emptyNote}</span>
                  </button>
                </li>
              ))}
            </ul> : <p className="widget-empty">{t.notesEmpty}</p>}
          </section>

          <MembersWidget workspace={workspace} />
        </div>}
      </div>
    </div>
  </main>;
}

function MembersWidget({ workspace }: { workspace: WorkspaceSummary }) {
  const { t: { workspace: { dashboard: t } } } = useI18n();
  const settings = useDesktopSettings("todo");
  const members = useWorkspaceMembers(workspace.id);
  const list = members.data?.members ?? [];
  return <Card size="sm" className="widget">
    <CardHeader>
      <CardTitle>{t.members}</CardTitle>
      {settings && canManageWorkspace(workspace.role) && (
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => settings.open("members")}><UserAdd data-icon="inline-start" />{t.invite}</Button>
        </CardAction>
      )}
    </CardHeader>
    <CardContent className="flex items-center gap-3">
      {members.isPending ? <Skeleton className="h-8 w-32" /> : <>
        <AvatarGroup>
          {list.slice(0, MAX_AVATARS).map((member) => (
            <Avatar key={member.id} title={member.name}>
              <AvatarFallback>{initials(member.name)}</AvatarFallback>
            </Avatar>
          ))}
          {list.length > MAX_AVATARS && <AvatarGroupCount>+{list.length - MAX_AVATARS}</AvatarGroupCount>}
        </AvatarGroup>
        <span className="text-sm text-muted-foreground">{t.memberCount(list.length)}</span>
      </>}
    </CardContent>
  </Card>;
}
