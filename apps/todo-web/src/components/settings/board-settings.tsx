import { useState } from "react";
import {
  projectColors,
  sortStatuses,
  statusCategories,
  statusColors,
  type BoardProject,
  type BoardStatus,
  type StatusCategory,
} from "@evido/todo-core/board";
import type { Command, WorkspaceData } from "@evido/todo-core/workspace";
import { SettingsSection } from "@evido/ui/components/settings-dialog";
import { Button } from "@evido/ui/components/button";
import { Input } from "@evido/ui/components/input";
import { Textarea } from "@evido/ui/components/textarea";
import { Progress } from "@evido/ui/components/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@evido/ui/components/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@evido/ui/components/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@evido/ui/components/dialog";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "@/components/icons";
import { StatusIcon, ProjectDot } from "@/components/board/board-meta";
import { useI18n } from "@/i18n";

export type BoardSettingsProps = {
  workspaceId: string;
  data: WorkspaceData;
  run: (command: Command) => Promise<boolean>;
  disabled: boolean;
};

function ColorMenu({ colors, value, label, disabled, onChange, children }: {
  colors: string[]; value: string; label: string; disabled: boolean; onChange: (color: string) => void; children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button className="settings-swatch-button" aria-label={label} title={label}>{children}</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="p-2">
        <DropdownMenuLabel className="sr-only">{label}</DropdownMenuLabel>
        <div className="grid grid-cols-5 gap-1.5">
          {colors.map((color) => (
            <DropdownMenuItem key={color} className="size-7 justify-center rounded-lg p-0" aria-label={color} onSelect={() => onChange(color)}>
              <span className="size-4 rounded-full" style={{ background: color, outline: color === value ? "2px solid var(--ring)" : undefined, outlineOffset: 2 }} />
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Saves on blur or Enter; Escape puts the old name back. */
function NameInput({ value, label, maxLength, disabled, onSave }: { value: string; label: string; maxLength: number; disabled: boolean; onSave: (name: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [shown, setShown] = useState(value);
  // Renamed elsewhere: show the new name.
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  return (
    <Input value={draft} aria-label={label} maxLength={maxLength} disabled={disabled} className="h-8 border-transparent bg-transparent px-2 shadow-none hover:bg-input/50 focus-visible:bg-input/50"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const next = draft.trim(); if (!next) setDraft(value); else if (next !== value) onSave(next); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { e.stopPropagation(); setDraft(value); }
      }} />
  );
}

export function StatusesSettings({ workspaceId, data, run, disabled }: BoardSettingsProps) {
  const { t: { board: { settings: s, categories } } } = useI18n();
  const statuses = sortStatuses(data.statuses ?? []);
  const [adding, setAdding] = useState<StatusCategory | null>(null);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<BoardStatus | null>(null);
  const [replacement, setReplacement] = useState("");
  const usage = (id: string) => data.todos.filter((todo) => todo.statusId === id).length;

  function add(event: React.FormEvent, category: StatusCategory) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const used = new Set(statuses.map((st) => st.color));
    void run({ type: "create-status", id: crypto.randomUUID(), workspaceId, name, category, color: statusColors.find((c) => !used.has(c)) ?? statusColors[0] });
    setNewName("");
    setAdding(null);
  }

  return (
    <>
      <SettingsSection title={s.statusesTitle} description={s.statusesHelp}>
        <div className="status-settings">
          {statusCategories.map((category) => {
            const group = statuses.filter((st) => st.category === category);
            return (
              <div key={category} className="status-group">
                <div className="status-group-heading">
                  <h4>{categories[category]}</h4>
                  <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={`${s.addStatus}: ${categories[category]}`} title={s.addStatus}
                    onClick={() => { setAdding(category); setNewName(""); }}><Plus /></Button>
                </div>
                <ul>
                  {group.map((status, index) => (
                    <li key={status.id} className="status-setting-row">
                      <ColorMenu colors={statusColors} value={status.color} label={s.color(status.name)} disabled={disabled}
                        onChange={(color) => void run({ type: "update-status", id: status.id, color })}>
                        <StatusIcon status={status} className="size-4" />
                      </ColorMenu>
                      <div className="min-w-0 flex-1"><NameInput value={status.name} label={s.rename(status.name)} maxLength={40} disabled={disabled}
                        onSave={(name) => void run({ type: "update-status", id: status.id, name })} /></div>
                      <span className="status-usage">{s.issueCount(usage(status.id))}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild disabled={disabled}>
                          <Button variant="ghost" size="icon-sm" aria-label={status.name}><MoreHorizontal /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-48">
                          {index > 0 && <DropdownMenuItem onSelect={() => void run({ type: "move-status", id: status.id, targetId: group[index - 1].id, placement: "before" })}>{s.moveUp(status.name)}</DropdownMenuItem>}
                          {index < group.length - 1 && <DropdownMenuItem onSelect={() => void run({ type: "move-status", id: status.id, targetId: group[index + 1].id, placement: "after" })}>{s.moveDown(status.name)}</DropdownMenuItem>}
                          <DropdownMenuLabel>{s.category(status.name)}</DropdownMenuLabel>
                          <DropdownMenuRadioGroup value={status.category} onValueChange={(next) => void run({ type: "update-status", id: status.id, category: next as StatusCategory })}>
                            {statusCategories.map((c) => <DropdownMenuRadioItem key={c} value={c}><StatusIcon status={{ category: c, color: status.color }} />{categories[c]}</DropdownMenuRadioItem>)}
                          </DropdownMenuRadioGroup>
                          <DropdownMenuItem variant="destructive" disabled={statuses.length < 2}
                            onSelect={() => { setDeleting(status); setReplacement(statuses.find((other) => other.id !== status.id && other.category === status.category)?.id ?? statuses.find((other) => other.id !== status.id)!.id); }}>
                            <Trash2 aria-hidden="true" />{s.deleteStatus(status.name)}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  ))}
                  {adding === category && (
                    <li>
                      <form className="status-setting-row" onSubmit={(event) => add(event, category)}>
                        <StatusIcon status={{ category, color: "var(--muted-foreground)" }} className="mx-1.5 size-4" />
                        <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={40} className="h-8 flex-1"
                          aria-label={s.newStatusName} placeholder={s.statusPlaceholder(categories[category])}
                          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setAdding(null); } }} />
                        <Button type="submit" size="sm" disabled={disabled || !newName.trim()}>{s.add}</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(null)}>{s.cancel}</Button>
                      </form>
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </SettingsSection>
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleting && s.deleteStatusTitle(deleting.name)}</AlertDialogTitle>
            <AlertDialogDescription>{deleting && s.deleteStatusBody(usage(deleting.id))}</AlertDialogDescription>
          </AlertDialogHeader>
          {deleting && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium" id="status-replacement">{s.moveTo}</span>
              <Select value={replacement} onValueChange={setReplacement}>
                <SelectTrigger aria-labelledby="status-replacement" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">
                  {statuses.filter((st) => st.id !== deleting.id).map((st) => (
                    <SelectItem key={st.id} value={st.id}><StatusIcon status={st} />{st.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{s.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={disabled || !replacement}
              onClick={() => { if (deleting) void run({ type: "delete-status", id: deleting.id, replacementId: replacement }); }}>
              {s.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ProjectsSettings({ workspaceId, data, run, disabled }: BoardSettingsProps) {
  const { t: { board: { settings: s } } } = useI18n();
  const projects = data.projects ?? [];
  const [editing, setEditing] = useState<{ id?: string; name: string; description: string; color: string } | null>(null);
  const [deleting, setDeleting] = useState<BoardProject | null>(null);
  const issuesOf = (id: string) => data.todos.filter((todo) => todo.projectId === id && !todo.parentId);

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || !editing.name.trim()) return;
    const fields = { name: editing.name.trim(), description: editing.description.trim(), color: editing.color };
    void run(editing.id ? { type: "update-project", id: editing.id, ...fields } : { type: "create-project", id: crypto.randomUUID(), workspaceId, ...fields });
    setEditing(null);
  }

  return (
    <>
      <SettingsSection title={s.projectsTitle} description={s.projectsHelp}>
        <div className="flex justify-end px-3 pt-3">
          <Button size="sm" disabled={disabled}
            onClick={() => setEditing({ name: "", description: "", color: projectColors[projects.length % projectColors.length] })}>
            <Plus data-icon="inline-start" />{s.addProject}
          </Button>
        </div>
        {!projects.length ? <p className="py-6 text-center text-sm text-muted-foreground">{s.noProjects}</p> : (
          <ul className="project-settings">
            {projects.map((project) => {
              const issues = issuesOf(project.id);
              const done = issues.filter((issue) => issue.completed).length;
              return (
                <li key={project.id} className="project-setting-row">
                  <ColorMenu colors={projectColors} value={project.color} label={s.editProject(project.name)} disabled={disabled}
                    onChange={(color) => void run({ type: "update-project", id: project.id, color })}>
                    <ProjectDot project={project} className="size-4" />
                  </ColorMenu>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{project.name}</p>
                    {project.description && <p className="truncate text-xs text-muted-foreground">{project.description}</p>}
                  </div>
                  <div className="project-progress" title={s.progress(done, issues.length)}>
                    <Progress value={issues.length ? (done / issues.length) * 100 : 0} aria-label={s.progress(done, issues.length)} />
                    <span>{s.issueCount(issues.length)}</span>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild disabled={disabled}>
                      <Button variant="ghost" size="icon-sm" aria-label={project.name}><MoreHorizontal /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing({ id: project.id, name: project.name, description: project.description, color: project.color })}><Pencil aria-hidden="true" />{s.editProject(project.name)}</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(project)}><Trash2 aria-hidden="true" />{s.deleteProject(project.name)}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? s.editProject(editing.name) : s.addProject}</DialogTitle>
            <DialogDescription>{s.projectsHelp}</DialogDescription>
          </DialogHeader>
          {editing && (
            <form onSubmit={save} className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <ColorMenu colors={projectColors} value={editing.color} label={s.projectName} disabled={false} onChange={(color) => setEditing({ ...editing, color })}>
                  <ProjectDot project={editing} className="size-5" />
                </ColorMenu>
                <Input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={80} required
                  aria-label={s.projectName} placeholder={s.projectPlaceholder} />
              </div>
              <Textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} maxLength={2000} rows={3}
                aria-label={s.projectDescription} placeholder={s.projectDescriptionPlaceholder} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>{s.cancel}</Button>
                <Button type="submit" disabled={disabled || !editing.name.trim()}>{editing.id ? s.save : s.add}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleting && s.deleteProjectTitle(deleting.name)}</AlertDialogTitle>
            <AlertDialogDescription>{s.deleteProjectBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{s.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={disabled} onClick={() => { if (deleting) void run({ type: "delete-project", id: deleting.id }); }}>{s.delete}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
