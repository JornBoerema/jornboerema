import type { ReactNode } from "react";
import {
  sortStatuses,
  statusCategories,
  type BoardMember,
  type BoardProject,
  type BoardStatus,
  type StatusCategory,
} from "@evido/todo-core/board";
import { cn } from "@evido/ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu";
import { Folder } from "@/components/icons";
import { useI18n } from "@/i18n";

/** Linear-style status glyph: dashed (backlog), ring, half-filled, check, cross. */
export function StatusIcon({ status, className }: { status?: Pick<BoardStatus, "category" | "color">; className?: string }) {
  const color = status?.color ?? "var(--muted-foreground)";
  const category: StatusCategory = status?.category ?? "unstarted";
  return (
    <svg viewBox="0 0 14 14" className={cn("size-3.5 shrink-0", className)} aria-hidden="true">
      {category === "backlog" && <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="1.6 1.6" />}
      {category === "unstarted" && <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.5" />}
      {category === "started" && (
        <>
          <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.5" />
          <path d="M7 3.5 A3.5 3.5 0 0 1 7 10.5 Z" fill={color} />
        </>
      )}
      {category === "completed" && (
        <>
          <circle cx="7" cy="7" r="7" fill={color} />
          <path d="M4.2 7.2 6.2 9.1 9.9 5.1" fill="none" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {category === "canceled" && (
        <>
          <circle cx="7" cy="7" r="7" fill={color} />
          <path d="M4.8 4.8 9.2 9.2M9.2 4.8 4.8 9.2" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/** 0 none (dots), 1 urgent (alert square), 2–4 signal bars. */
export function PriorityIcon({ priority, className }: { priority: number; className?: string }) {
  if (priority === 1)
    return (
      <svg viewBox="0 0 14 14" className={cn("size-3.5 shrink-0", className)} aria-hidden="true">
        <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="#f2994a" />
        <path d="M7 3.5v4.2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="10.2" r="0.95" fill="#fff" />
      </svg>
    );
  if (priority === 0)
    return (
      <svg viewBox="0 0 14 14" className={cn("size-3.5 shrink-0 text-muted-foreground", className)} aria-hidden="true">
        {[2.5, 7, 11.5].map((x) => <rect key={x} x={x - 1} y="6.25" width="2" height="1.5" rx="0.5" fill="currentColor" />)}
      </svg>
    );
  const filled = 5 - priority; // high 3, medium 2, low 1
  return (
    <svg viewBox="0 0 14 14" className={cn("size-3.5 shrink-0 text-foreground", className)} aria-hidden="true">
      {[0, 1, 2].map((bar) => (
        <rect key={bar} x={1.5 + bar * 4} y={9 - bar * 3} width="3" height={4 + bar * 3} rx="0.75"
          fill="currentColor" opacity={bar < filled ? 1 : 0.25} />
      ))}
    </svg>
  );
}

export function ProjectDot({ project, className }: { project?: Pick<BoardProject, "color">; className?: string }) {
  if (!project) return <Folder className={cn("size-3.5 shrink-0 text-muted-foreground", className)} aria-hidden="true" />;
  return (
    <svg viewBox="0 0 14 14" className={cn("size-3.5 shrink-0", className)} aria-hidden="true">
      <path d="M1.5 3.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" fill={project.color} />
    </svg>
  );
}

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
function hue(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}
export function MemberAvatar({ member, size = 20, className }: { member: BoardMember; size?: number; className?: string }) {
  return member.image ? (
    <img src={member.image} alt="" width={size} height={size} className={cn("shrink-0 rounded-full object-cover ring-2 ring-background", className)} style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white ring-2 ring-background", className)}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `oklch(0.62 0.12 ${hue(member.id)})` }}>
      {initials(member.name || member.email)}
    </span>
  );
}
export function AvatarStack({ members, size = 20, max = 3 }: { members: BoardMember[]; size?: number; max?: number }) {
  if (!members.length) return null;
  return (
    <span className="flex items-center -space-x-1.5" title={members.map((m) => m.name || m.email).join(", ")}>
      {members.slice(0, max).map((m) => <MemberAvatar key={m.id} member={m} size={size} />)}
      {members.length > max && <span className="inline-flex items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground ring-2 ring-background" style={{ width: size, height: size }}>+{members.length - max}</span>}
    </span>
  );
}

type MenuProps = { children: ReactNode; disabled?: boolean; align?: "start" | "end" };

export function StatusMenu({ statuses, value, onChange, children, disabled, align = "start" }: MenuProps & {
  statuses: BoardStatus[]; value?: string; onChange: (id: string) => void;
}) {
  const { t: { board: t } } = useI18n();
  const sorted = sortStatuses(statuses);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-48">
        <DropdownMenuLabel>{t.properties.status}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={onChange}>
          {statusCategories.map((category) => sorted.filter((s) => s.category === category).map((status) => (
            <DropdownMenuRadioItem key={status.id} value={status.id}>
              <StatusIcon status={status} />
              {status.name}
            </DropdownMenuRadioItem>
          )))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PriorityMenu({ value, onChange, children, disabled, align = "start" }: MenuProps & {
  value: number; onChange: (priority: number) => void;
}) {
  const { t: { board: t } } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-44">
        <DropdownMenuLabel>{t.priority.label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(value)} onValueChange={(next) => onChange(Number(next))}>
          {[0, 1, 2, 3, 4].map((priority) => (
            <DropdownMenuRadioItem key={priority} value={String(priority)}>
              <PriorityIcon priority={priority} />
              {t.priority.name(priority)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectMenu({ projects, value, onChange, children, disabled, align = "start" }: MenuProps & {
  projects: BoardProject[]; value?: string; onChange: (id: string | null) => void;
}) {
  const { t: { board: t } } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-80 min-w-48">
        <DropdownMenuLabel>{t.properties.project}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={(next) => onChange(next || null)}>
          <DropdownMenuRadioItem value="">
            <ProjectDot />
            {t.properties.noProject}
          </DropdownMenuRadioItem>
          {projects.map((project) => (
            <DropdownMenuRadioItem key={project.id} value={project.id}>
              <ProjectDot project={project} />
              <span className="truncate">{project.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AssigneeMenu({ members, value, onChange, children, disabled, align = "start" }: MenuProps & {
  members: BoardMember[]; value: string[]; onChange: (ids: string[]) => void;
}) {
  const { t: { board: t } } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-80 min-w-56">
        <DropdownMenuLabel>{t.properties.assignees}</DropdownMenuLabel>
        {!members.length && <p className="px-2 py-1.5 text-xs text-muted-foreground">{t.properties.noMembers}</p>}
        <DropdownMenuGroup>
          {members.map((member) => (
            <DropdownMenuCheckboxItem key={member.id} checked={value.includes(member.id)}
              // Stay open, so several people can be picked in one go.
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => onChange(checked ? [...value, member.id] : value.filter((id) => id !== member.id))}>
              <MemberAvatar member={member} size={18} />
              <span className="truncate">{member.name || member.email}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        {value.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={false} onCheckedChange={() => onChange([])}>{t.properties.noAssignees}</DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
