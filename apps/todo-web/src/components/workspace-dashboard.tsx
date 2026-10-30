import { useEffect, useState } from "react";
import { Note, ArrowRight, ListTodo, Plus } from "@/components/icons";
import { Button } from "@evido/ui/components/button";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from "@evido/ui/components/empty";
import { sortTodos, type WorkspaceData } from "@evido/todo-core/workspace";
import { useI18n } from "@/i18n";

export function WorkspaceDashboard({ data, name, onSelect, onCreate, disabled }: {
  data: WorkspaceData; name: string; onSelect: (id: string) => void;
  onCreate: (kind: "todo" | "note") => void; disabled: boolean;
}) {
  const { t: { workspace: { dashboard: t } }, locale } = useI18n();
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
  const taskLists = new Set(data.lists.filter((list) => (list.kind ?? "todo") === "todo").map((list) => list.id));
  const tasks = data.todos.filter((item) => taskLists.has(item.listId));
  const open = tasks.filter((item) => !item.completed);
  const busy = open.filter((item) => item.inProgress);
  const done = tasks.filter((item) => item.completed).length;
  const suggestions = sortTodos(busy.length ? busy : open).slice(0, 3);
  return <div className="dashboard">
    <header className="dashboard-heading">
      <h1>{greeting}{firstName ? `, ${firstName}` : ""}.</h1>
      <p>{now ? new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(now) : t.tagline}</p>
    </header>
    <dl className="dashboard-stats" aria-label={t.statsLabel}>
      {[{ label: t.tasksOpen, value: open.length }, { label: t.inProgress, value: busy.length }, { label: t.tasksDone, value: done }].map((stat) => <div key={stat.label}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}
    </dl>
    {!data.lists.length ? <Empty className="py-10">
      <EmptyHeader><EmptyTitle>{t.emptyTitle}</EmptyTitle><EmptyDescription>{t.emptyBody}</EmptyDescription></EmptyHeader>
      <EmptyContent><div className="flex flex-wrap justify-center gap-2"><Button disabled={disabled} onClick={() => onCreate("todo")}><Plus data-icon="inline-start" />{t.createTaskList}</Button><Button variant="outline" disabled={disabled} onClick={() => onCreate("note")}>{t.createNoteCta}</Button></div></EmptyContent>
    </Empty> : <>
      <section className="dashboard-section" aria-labelledby="dashboard-focus">
        <h2 id="dashboard-focus">{busy.length ? t.continue : open.length ? t.pickOne : t.nothing}</h2>
        {suggestions.length ? <div className="dashboard-links">{suggestions.map((item) => <button key={item.id} className="dashboard-row" onClick={() => onSelect(item.listId)}>
          <span className="dashboard-row-body"><span>{item.title}</span><span className="dashboard-detail">{data.lists.find((list) => list.id === item.listId)?.name}</span></span><ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        </button>)}</div> : <p className="dashboard-note">{tasks.length ? t.allDone : t.noOpen}</p>}
      </section>
      {(["todo", "note"] as const).map((kind) => {
        const lists = data.lists.filter((list) => (list.kind ?? "todo") === kind);
        const Icon = kind === "note" ? Note : ListTodo;
        return <section className="dashboard-section" key={kind} aria-labelledby={`overview-${kind}`}>
          <div className="dashboard-section-heading"><h2 id={`overview-${kind}`}>{kind === "note" ? t.yourNotes : t.yourTaskLists}</h2><Button variant="ghost" size="sm" disabled={disabled} onClick={() => onCreate(kind)}><Plus data-icon="inline-start" />{kind === "note" ? t.createNote : t.createList}</Button></div>
          {lists.length ? <div className="dashboard-links">{lists.map((list) => {
            const items = data.todos.filter((item) => item.listId === list.id);
            const remaining = items.filter((item) => !item.completed);
            return <button key={list.id} className="dashboard-row" onClick={() => onSelect(list.id)}>
              <Icon className="size-4 shrink-0" aria-hidden="true" /><span className="dashboard-row-body"><span>{list.name}</span><span className="dashboard-detail">{kind === "note" ? (list.note?.markdown ? t.note : t.empty) : remaining.length ? t.openCount(remaining.length) : items.length ? t.allChecked : t.empty}</span></span>
              <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
            </button>;
          })}</div> : <p className="dashboard-note">{kind === "note" ? t.noNotes : t.noTaskLists}</p>}
        </section>;
      })}
    </>}
  </div>;
}
