import { useEffect, useState } from "react";
import { Note, ArrowRight, ListTodo, Plus } from "@/components/icons";
import { Button } from "@evido/ui/components/button";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from "@evido/ui/components/empty";
import { sortTodos, type WorkspaceData } from "@evido/todo-core/workspace";

export function WorkspaceDashboard({ data, name, onSelect, onCreate, disabled }: {
  data: WorkspaceData; name: string; onSelect: (id: string) => void;
  onCreate: (kind: "todo" | "note") => void; disabled: boolean;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 60000);
    return () => window.clearInterval(timer);
  }, []);
  const hour = now?.getHours();
  const greeting = hour === undefined ? "Welkom" : hour < 12 ? "Goedemorgen" : hour < 18 ? "Goedemiddag" : "Goedenavond";
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
      <p>{now ? new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long" }).format(now) : "Jouw lijsten op één plek."}</p>
    </header>
    <dl className="dashboard-stats" aria-label="Jouw overzicht">
      {[{ label: "Taken open", value: open.length }, { label: "Mee bezig", value: busy.length }, { label: "Taken afgevinkt", value: done }].map((stat) => <div key={stat.label}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}
    </dl>
    {!data.lists.length ? <Empty className="py-10">
      <EmptyHeader><EmptyTitle>Wat wil je even doen?</EmptyTitle><EmptyDescription>Maak een lijst voor je taken of een notitie voor je ideeën.</EmptyDescription></EmptyHeader>
      <EmptyContent><div className="flex flex-wrap justify-center gap-2"><Button disabled={disabled} onClick={() => onCreate("todo")}><Plus data-icon="inline-start" />Een takenlijst maken</Button><Button variant="outline" disabled={disabled} onClick={() => onCreate("note")}>Een notitie maken</Button></div></EmptyContent>
    </Empty> : <>
      <section className="dashboard-section" aria-labelledby="dashboard-focus">
        <h2 id="dashboard-focus">{busy.length ? "Ga verder waar je was" : open.length ? "Pak er eentje op" : "Even niets te doen"}</h2>
        {suggestions.length ? <div className="dashboard-links">{suggestions.map((item) => <button key={item.id} className="dashboard-row" onClick={() => onSelect(item.listId)}>
          <span className="dashboard-row-body"><span>{item.title}</span><span className="dashboard-detail">{data.lists.find((list) => list.id === item.listId)?.name}</span></span><ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        </button>)}</div> : <p className="dashboard-note">{tasks.length ? "Al je taken zijn afgevinkt. Lekker gedaan." : "Je hebt nog geen open taken. Voeg er een toe in een takenlijst."}</p>}
      </section>
      {(["todo", "note"] as const).map((kind) => {
        const lists = data.lists.filter((list) => (list.kind ?? "todo") === kind);
        const Icon = kind === "note" ? Note : ListTodo;
        return <section className="dashboard-section" key={kind} aria-labelledby={`overview-${kind}`}>
          <div className="dashboard-section-heading"><h2 id={`overview-${kind}`}>{kind === "note" ? "Je notities" : "Je takenlijsten"}</h2><Button variant="ghost" size="sm" disabled={disabled} onClick={() => onCreate(kind)}><Plus data-icon="inline-start" />{kind === "note" ? "Notitie maken" : "Takenlijst maken"}</Button></div>
          {lists.length ? <div className="dashboard-links">{lists.map((list) => {
            const items = data.todos.filter((item) => item.listId === list.id);
            const remaining = items.filter((item) => !item.completed);
            return <button key={list.id} className="dashboard-row" onClick={() => onSelect(list.id)}>
              <Icon className="size-4 shrink-0" aria-hidden="true" /><span className="dashboard-row-body"><span>{list.name}</span><span className="dashboard-detail">{kind === "note" ? (list.note?.markdown ? "Notitie" : "Nog leeg") : remaining.length ? `${remaining.length} open` : items.length ? "Alles afgevinkt" : "Nog leeg"}</span></span>
              <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
            </button>;
          })}</div> : <p className="dashboard-note">{kind === "note" ? "Nog geen notities." : "Nog geen takenlijsten."}</p>}
        </section>;
      })}
    </>}
  </div>;
}
