import { useEffect, useRef } from "react";
import { sortStatuses, statusCategories } from "@evido/todo-core/board";
import type { Command as RunCommand, Todo, WorkspaceData } from "@evido/todo-core/workspace";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@evido/ui/components/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@evido/ui/components/command";
import { useI18n } from "@/i18n";
import { MemberAvatar, PriorityIcon, ProjectDot, StatusIcon } from "./board-meta";

export type IssueField = "status" | "priority" | "assignees" | "project";

/** Linear's keys: S status, P priority, A assignees, ⇧P project. */
export function fieldForKey(event: KeyboardEvent): IssueField | undefined {
  const key = event.key.toLowerCase();
  if (key === "p") return event.shiftKey ? "project" : "priority";
  if (event.shiftKey) return undefined;
  if (key === "s") return "status";
  if (key === "a") return "assignees";
  return undefined;
}

/** True while the person is typing, so single-key shortcuts stay out of the way. */
export function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])");
}

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();

/** A ⌘K-style palette that changes one field of one issue. */
export function IssueSpotlight({ field, issue, data, run, onClose }: {
  field: IssueField;
  issue: Todo;
  data: WorkspaceData;
  run: (command: RunCommand) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t: { board: t } } = useI18n();
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { previousFocus.current = document.activeElement as HTMLElement; }, []);
  const update = (patch: Omit<Extract<RunCommand, { type: "update-issue" }>, "type" | "id">) =>
    void run({ type: "update-issue", id: issue.id, ...patch });
  const choose = (patch: Parameters<typeof update>[0]) => { update(patch); onClose(); };
  const assigneeIds = issue.assigneeIds ?? [];
  const label = { status: t.properties.status, priority: t.properties.priority, assignees: t.properties.assignees, project: t.properties.project }[field];
  const statuses = sortStatuses(data.statuses ?? []);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="list-spotlight issue-spotlight" style={{ translate: "-50% 0" }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const previous = previousFocus.current;
          if (previous?.isConnected && !previous.closest("[inert]")) previous.focus({ preventScroll: true });
        }}>
        <DialogTitle className="sr-only">{t.properties.change(label)}</DialogTitle>
        <DialogDescription className="sr-only">{t.shortcuts.spotlightDescription}</DialogDescription>
        <p className="issue-spotlight-target">
          <span className="issue-number">#{issue.number}</span>
          <span className="truncate">{issue.title}</span>
        </p>
        <Command loop filter={(_value, search, keywords) => normalize(search).trim().split(/\s+/).every((word) => normalize((keywords ?? []).join(" ")).includes(word)) ? 1 : 0}>
          <CommandInput aria-label={t.properties.change(label)} placeholder={t.shortcuts.placeholder(label)} autoComplete="off" autoCorrect="off" spellCheck={false} />
          <CommandList aria-label={label}>
            <CommandEmpty>{t.shortcuts.empty}</CommandEmpty>
            {field === "status" && (
              <CommandGroup>
                {statusCategories.flatMap((category) => statuses.filter((status) => status.category === category)).map((status) => (
                  <CommandItem key={status.id} value={status.id} keywords={[status.name, t.categories[status.category]]}
                    data-checked={status.id === issue.statusId} onSelect={() => choose({ statusId: status.id })}>
                    <StatusIcon status={status} /><span className="spotlight-name">{status.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {field === "priority" && (
              <CommandGroup>
                {[0, 1, 2, 3, 4].map((priority) => (
                  <CommandItem key={priority} value={String(priority)} keywords={[t.priority.name(priority), String(priority)]}
                    data-checked={(issue.priority ?? 0) === priority} onSelect={() => choose({ priority })}>
                    <PriorityIcon priority={priority} /><span className="spotlight-name">{t.priority.name(priority)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {field === "assignees" && (
              <CommandGroup>
                {(data.members ?? []).map((member) => {
                  const checked = assigneeIds.includes(member.id);
                  return (
                    // Toggles and stays open, so several people can be picked in one go.
                    <CommandItem key={member.id} value={member.id} keywords={[member.name, member.email]} data-checked={checked}
                      onSelect={() => update({ assigneeIds: checked ? assigneeIds.filter((id) => id !== member.id) : [...assigneeIds, member.id] })}>
                      <MemberAvatar member={member} size={20} /><span className="spotlight-name">{member.name || member.email}</span>
                    </CommandItem>
                  );
                })}
                {assigneeIds.length > 0 && (
                  <CommandItem value="none" keywords={[t.properties.noAssignees]} onSelect={() => choose({ assigneeIds: [] })}>
                    <span className="size-5 shrink-0" aria-hidden="true" /><span className="spotlight-name">{t.properties.noAssignees}</span>
                  </CommandItem>
                )}
              </CommandGroup>
            )}
            {field === "project" && (
              <CommandGroup>
                <CommandItem value="none" keywords={[t.properties.noProject]} data-checked={!issue.projectId} onSelect={() => choose({ projectId: null })}>
                  <ProjectDot /><span className="spotlight-name">{t.properties.noProject}</span>
                </CommandItem>
                {(data.projects ?? []).map((project) => (
                  <CommandItem key={project.id} value={project.id} keywords={[project.name]}
                    data-checked={project.id === issue.projectId} onSelect={() => choose({ projectId: project.id })}>
                    <ProjectDot project={project} /><span className="spotlight-name">{project.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
        <p className="spotlight-help">
          <span>{t.shortcuts.choose}</span>
          <span>{field === "assignees" ? t.shortcuts.toggle : t.shortcuts.apply}</span>
          <span>{t.shortcuts.close}</span>
        </p>
      </DialogContent>
    </Dialog>
  );
}
