import { useEffect, useState } from "react";
import { Note, Plus, UserAdd } from "@/components/icons";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@evido/ui/components/avatar";
import { Button } from "@evido/ui/components/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@evido/ui/components/card";
import { Checkbox } from "@evido/ui/components/checkbox";
import { Progress } from "@evido/ui/components/progress";
import { Skeleton } from "@evido/ui/components/skeleton";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from "@evido/ui/components/empty";
import { sortTodos, type Command, type Todo, type WorkspaceData } from "@evido/todo-core/workspace";
import { canManageWorkspace, type WorkspaceSummary } from "@evido/todo-core/workspaces";
import { useSettings } from "@/components/settings/workspace-settings";
import { useWorkspaceMembers } from "@/lib/workspaces";
import { useI18n } from "@/i18n";

const MAX_AVATARS = 5;
const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";

/** First meaningful line of a note, without Markdown and without repeating its title. */
function excerpt(markdown: string, title: string) {
  const plain = (line: string) =>
    line.trim().replace(/^(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s+|\d+\.\s+)/, "").replace(/[*_`~]/g, "").trim();
  const same = (line: string) => line.toLocaleLowerCase() === title.trim().toLocaleLowerCase();
  return markdown.split("\n").map(plain).find((line) => line && !same(line)) ?? "";
}

/** Overview as a grid of widgets: numbers, progress, in progress, members, notes. */
export function WorkspaceDashboard({ data, name, workspace, onSelect, onCreate, run, disabled }: {
  data: WorkspaceData; name: string; workspace?: WorkspaceSummary; onSelect: (id: string) => void;
  onCreate: (kind: "todo" | "note") => void; run: (command: Command) => Promise<boolean>; disabled: boolean;
}) {
  const { t: { workspace: wt }, locale } = useI18n();
  const t = wt.dashboard;
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 60000);
    return () => window.clearInterval(timer);
  }, []);
  const hour = now?.getHours();
  const greeting = hour === undefined ? t.welcome : hour < 12 ? t.morning : hour < 18 ? t.afternoon : t.evening;
  const firstName = name.trim().split(/\s+/)[0];

  const taskLists = data.lists.filter((list) => (list.kind ?? "todo") === "todo");
  const notes = data.lists.filter((list) => list.kind === "note");
  const listIds = new Set(taskLists.map((list) => list.id));
  const tasks = data.todos.filter((item) => listIds.has(item.listId));
  const open = tasks.filter((item) => !item.completed);
  const busy = sortTodos(open.filter((item) => item.inProgress));
  const done = tasks.length - open.length;
  const listName = (id: string) => data.lists.find((list) => list.id === id)?.name ?? "";

  // Same cycle as in a list: to do → in progress → done.
  const toggle = (todo: Todo) =>
    void run({ type: "update-todo", id: todo.id, completed: !todo.completed && !!todo.inProgress, inProgress: !todo.completed && !todo.inProgress });

  const stats = [
    { label: t.stats.open, value: open.length },
    { label: t.stats.inProgress, value: busy.length },
    { label: t.stats.done, value: done },
    { label: t.stats.lists, value: taskLists.length },
  ];

  return <div className="dashboard">
    <div className="task-heading">
      <div className="min-w-0 flex-1">
        <h1>{greeting}{firstName ? `, ${firstName}` : ""}.</h1>
        <p>{now && new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(now)}</p>
      </div>
    </div>

    {!data.lists.length ? <Empty className="py-10">
      <EmptyHeader><EmptyTitle>{t.emptyTitle}</EmptyTitle><EmptyDescription>{t.emptyBody}</EmptyDescription></EmptyHeader>
      <EmptyContent><div className="flex flex-wrap justify-center gap-2"><Button disabled={disabled} onClick={() => onCreate("todo")}><Plus data-icon="inline-start" />{t.createTaskList}</Button><Button variant="outline" disabled={disabled} onClick={() => onCreate("note")}>{t.createNoteCta}</Button></div></EmptyContent>
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
        <CardHeader><CardTitle>{t.progress}</CardTitle></CardHeader>
        <CardContent>
          {tasks.length ? <ul className="flex flex-col gap-1">
            {taskLists.filter((list) => tasks.some((item) => item.listId === list.id)).map((list) => {
              const items = tasks.filter((item) => item.listId === list.id);
              const finished = items.filter((item) => item.completed).length;
              return <li key={list.id}>
                <button type="button" className="widget-progress-row" onClick={() => onSelect(list.id)}>
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
                <button type="button" className="widget-task-body" onClick={() => onSelect(todo.listId)}>
                  <span className="truncate">{todo.title}</span>
                  <span className="truncate text-xs text-muted-foreground">{listName(todo.listId)}</span>
                </button>
              </li>
            ))}
          </ul> : <p className="widget-empty">{t.inProgressEmpty}</p>}
        </CardContent>
      </Card>

      {workspace && <MembersWidget workspace={workspace} />}

      <Card size="sm" className="widget">
        <CardHeader>
          <CardTitle>{t.notes}</CardTitle>
          <CardAction>
            <Button variant="ghost" size="icon-sm" aria-label={t.newNote} title={t.newNote} disabled={disabled} onClick={() => onCreate("note")}><Plus /></Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {notes.length ? <ul className="flex flex-col">
            {notes.slice(0, 5).map((note) => (
              <li key={note.id}>
                <button type="button" className="widget-note" onClick={() => onSelect(note.id)}>
                  <Note className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{note.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{excerpt(note.note?.markdown ?? "", note.name) || t.emptyNote}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul> : <p className="widget-empty">{t.notesEmpty}</p>}
        </CardContent>
      </Card>
    </div>}
  </div>;
}

function MembersWidget({ workspace }: { workspace: WorkspaceSummary }) {
  const { t: { workspace: { dashboard: t } } } = useI18n();
  const settings = useSettings();
  const members = useWorkspaceMembers(workspace.id);
  const list = members.data?.members ?? [];
  return <Card size="sm" className="widget">
    <CardHeader>
      <CardTitle>{t.members}</CardTitle>
      {canManageWorkspace(workspace.role) && (
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
