import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@evido/ui/components/dialog";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@evido/ui/components/command";
import { Note, Home } from "@/components/icons";
import type { TodoList } from "@evido/todo-core/workspace";
import { useI18n } from "@/i18n";

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();

/** ⌘K / Ctrl+K: jump to a note by its title or its text. */
export function ListSpotlight({ notes, selectedId, onSelect, onOverview }: {
  notes: TodoList[]; selectedId?: string; onSelect: (id: string) => void; onOverview: () => void;
}) {
  const { t: { workspace: { spotlight: t } } } = useI18n();
  const [open, setOpen] = useState(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const navigating = useRef(false);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k" || event.altKey || event.shiftKey || event.repeat || event.isComposing) return;
      // Do not interrupt editing or confirmation dialogs.
      if (!open && document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      if (!open) previousFocus.current = document.activeElement as HTMLElement;
      setOpen(!open);
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [open]);
  function choose(id?: string) {
    navigating.current = true;
    setOpen(false);
    if (id) onSelect(id); else onOverview();
  }
  return <Dialog open={open} onOpenChange={(value) => {
    if (value) previousFocus.current = document.activeElement as HTMLElement;
    setOpen(value);
  }}>
    <DialogContent showCloseButton={false} className="list-spotlight" style={{ translate: "-50% 0" }} onCloseAutoFocus={(event) => {
      event.preventDefault();
      const previous = previousFocus.current;
      if (!navigating.current && previous?.isConnected && !previous.closest('[inert]')) previous.focus();
      else document.getElementById("notes")?.focus({ preventScroll: true });
      navigating.current = false;
    }}>
      <DialogTitle className="sr-only">{t.title}</DialogTitle>
      <DialogDescription className="sr-only">{t.description}</DialogDescription>
      <Command loop filter={(_value, search, keywords) => normalize(search).trim().split(/\s+/).every((word) => normalize((keywords ?? []).join(" ")).includes(word)) ? 1 : 0}>
        <CommandInput aria-label={t.search} placeholder={t.placeholder} autoComplete="off" autoCorrect="off" spellCheck={false} />
        <CommandList aria-label={t.results}>
          <CommandEmpty>{t.empty}</CommandEmpty>
          <CommandGroup>
            <CommandItem value="overview" keywords={t.overviewKeywords.split(" ")} data-checked={!selectedId} onSelect={() => choose()}><Home /><span>{t.overview}</span></CommandItem>
          </CommandGroup>
          {notes.length > 0 && <CommandGroup heading={t.notes}>
            {notes.map((note) => <CommandItem key={note.id} value={note.id} keywords={[note.name, (note.note?.markdown ?? "").slice(0, 2000)]} data-checked={note.id === selectedId} onSelect={() => choose(note.id)}>
              <Note /><span className="spotlight-name">{note.name}</span>
              {note.id === selectedId && <span className="sr-only">{t.current}</span>}
            </CommandItem>)}
          </CommandGroup>}
        </CommandList>
      </Command>
      <p className="spotlight-help"><span>{t.choose}</span><span>{t.open}</span><span>{t.close}</span></p>
    </DialogContent>
  </Dialog>;
}
