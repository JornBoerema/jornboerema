import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@evido/ui/components/dialog";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@evido/ui/components/command";
import { Note, Home, ListTodo } from "@/components/icons";
import type { TodoList } from "@evido/todo-core/workspace";

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("nl");
export function ListSpotlight({ lists, selectedId, onSelect, onOverview }: {
  lists: TodoList[]; selectedId?: string; onSelect: (id: string) => void; onOverview: () => void;
}) {
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
      else document.getElementById("taken")?.focus({ preventScroll: true });
      navigating.current = false;
    }}>
      <DialogTitle className="sr-only">Ga naar een lijst</DialogTitle>
      <DialogDescription className="sr-only">Zoek een lijst. Gebruik de pijltjestoetsen om te kiezen en Enter om te openen.</DialogDescription>
      <Command loop filter={(_value, search, keywords) => normalize(search).trim().split(/\s+/).every((word) => normalize((keywords ?? []).join(" ")).includes(word)) ? 1 : 0}>
        <CommandInput aria-label="Zoek een lijst" placeholder="Zoek een lijst…" autoComplete="off" autoCorrect="off" spellCheck={false} />
        <CommandList aria-label="Lijsten">
          <CommandEmpty>Geen lijsten gevonden. Probeer een andere naam.</CommandEmpty>
          <CommandGroup>
            <CommandItem value="overview" keywords={["Overzicht", "Dashboard", "Home"]} data-checked={!selectedId} onSelect={() => choose()}><Home /><span>Overzicht</span></CommandItem>
          </CommandGroup>
          {(["todo", "note"] as const).map((kind) => {
            const matches = lists.filter((list) => (list.kind ?? "todo") === kind);
            const Icon = kind === "note" ? Note : ListTodo;
            return matches.length > 0 && <CommandGroup key={kind} heading={kind === "note" ? "Notities" : "Takenlijsten"}>
              {matches.map((list) => <CommandItem key={list.id} value={list.id} keywords={[list.name, kind === "note" ? "notities" : "taken"]} data-checked={list.id === selectedId} onSelect={() => choose(list.id)}>
                <Icon /><span className="spotlight-name">{list.name}</span>
                {list.id === selectedId && <span className="sr-only">Huidige lijst</span>}
              </CommandItem>)}
            </CommandGroup>;
          })}
        </CommandList>
      </Command>
      <p className="spotlight-help"><span>↑ ↓ kiezen</span><span>↵ openen</span><span>esc sluiten</span></p>
    </DialogContent>
  </Dialog>;
}
