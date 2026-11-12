import { useEffect, useState } from "react";
import { Note, Plus } from "@/components/icons";
import { Button } from "@evido/ui/components/button";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from "@evido/ui/components/empty";
import type { TodoList } from "@evido/todo-core/workspace";
import { useI18n } from "@/i18n";

/** First meaningful lines of a note, without Markdown and without repeating its title. */
function excerpt(markdown: string, title: string) {
  const plain = (line: string) =>
    line.trim().replace(/^(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s+|\d+\.\s+)/, "").replace(/[*_`~]/g, "").trim();
  const same = (line: string) => line.toLocaleLowerCase() === title.trim().toLocaleLowerCase();
  return markdown.split("\n").map(plain).filter((line) => line && !same(line)).slice(0, 4).join(" ");
}

/** Overview: a greeting and every note as a card, in sidebar order. */
export function WorkspaceDashboard({ notes, name, onSelect, onCreate, disabled }: {
  notes: TodoList[]; name: string; onSelect: (id: string) => void; onCreate: () => void; disabled: boolean;
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

  return <div className="dashboard note-dashboard">
    <div className="task-heading">
      <div className="min-w-0 flex-1">
        <h1>{greeting}{firstName ? `, ${firstName}` : ""}.</h1>
        <p>{now && new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(now)}</p>
      </div>
      {notes.length > 0 && <Button disabled={disabled} onClick={onCreate}><Plus data-icon="inline-start" />{t.newNote}</Button>}
    </div>

    {!notes.length ? <Empty className="py-10">
      <EmptyHeader>
        <EmptyMedia><Note className="size-8 text-primary" /></EmptyMedia>
        <EmptyTitle>{t.emptyTitle}</EmptyTitle>
        <EmptyDescription>{t.emptyBody}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent><Button disabled={disabled} onClick={onCreate}><Plus data-icon="inline-start" />{t.newNote}</Button></EmptyContent>
    </Empty> : <ul className="note-grid" aria-label={t.notes}>
      {notes.map((note) => (
        <li key={note.id}>
          <button type="button" className="note-card" onClick={() => onSelect(note.id)}>
            <span className="note-card-title">{note.name}</span>
            <span className="note-card-excerpt">{excerpt(note.note?.markdown ?? "", note.name) || t.emptyNote}</span>
          </button>
        </li>
      ))}
    </ul>}
  </div>;
}
