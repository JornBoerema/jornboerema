import { z } from "zod";
import {
  statusCategories,
  statusFlags,
  defaultStatus,
  sortStatuses,
  type BoardMember,
  type BoardProject,
  type BoardStatus,
  type TodoAttachment,
} from "./board";
export type ListKind = "todo" | "note" | "board";
export type TodoList = {
  id: string;
  name: string;
  kind?: ListKind;
  note?: { markdown: string; version: number };
  createdAt: string;
  role: "owner" | "editor" | "viewer";
};
export type Todo = {
  id: string;
  listId: string;
  title: string;
  completed: boolean;
  inProgress?: boolean;
  position?: number;
  createdAt: string;
  /** The mail it was made from. `url` opens it, for whoever's mailbox it is in. */
  mail?: TodoMail;
  // Board issues only (lists of kind "board").
  number?: number;
  description?: string;
  statusId?: string;
  projectId?: string;
  priority?: number;
  parentId?: string;
  assigneeIds?: string[];
  attachments?: TodoAttachment[];
};
export type TodoMail = { subject: string; from: string | null; url: string | null };
export type WorkspaceData = {
  lists: TodoList[];
  todos: Todo[];
  /** Board columns, shared by every board in the workspace. */
  statuses?: BoardStatus[];
  projects?: BoardProject[];
  /** Who issues can be assigned to; absent on link-shared lists. */
  members?: BoardMember[];
};
// Validation messages are stable codes; the API translates them (apps/api/src/i18n.ts).
const id = z.string().uuid();
const listName = z.string().trim().min(1, "list_name_required").max(80);
const title = z.string().trim().min(1, "task_title_required").max(500);
const description = z.string().max(50000, "description_too_long");
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const statusName = z.string().trim().min(1, "status_name_required").max(40);
const projectName = z.string().trim().min(1, "project_name_required").max(80);
const priority = z.number().int().min(0).max(4);
// User ids come from Better Auth and are not UUIDs.
const assigneeIds = z.array(z.string().min(1).max(64)).max(20);
const placement = z.enum(["before", "after"]);
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("update-note"), id, markdown: z.string().max(100000, "note_too_long"), version: z.number().int().min(0) }),
  z.object({ type: z.literal("create-list"), id, workspaceId: id, name: listName, kind: z.enum(["todo", "note", "board"]).optional(), markdown: z.string().max(100000).optional() }).refine((value) => value.markdown === undefined || value.kind === "note", "content_notes_only"),
  z.object({ type: z.literal("rename-list"), id, name: listName }),
  z.object({ type: z.literal("delete-list"), id }),
  z.object({ type: z.literal("create-todo"), id, listId: id, title }),
  z
    .object({
      type: z.literal("update-todo"),
      id,
      title: title.optional(),
      completed: z.boolean().optional(),
      inProgress: z.boolean().optional(),
    })
    .refine((v) => v.title !== undefined || v.completed !== undefined || v.inProgress !== undefined)
    .refine((v) => !(v.completed && v.inProgress)),
  z.object({ type: z.literal("delete-todo"), id }),
  z.object({ type: z.literal("clear-done"), listId: id }),
  z.object({ type: z.literal("move-todo"), id, targetId: id, placement: z.enum(["before", "after"]) }),
  z.object({ type: z.literal("move-list"), id, targetId: id, placement: z.enum(["before", "after"]) }),
  // ── Boards ──
  z.object({
    type: z.literal("create-issue"),
    id,
    listId: id,
    title,
    description: description.optional(),
    statusId: id.optional(),
    projectId: id.nullable().optional(),
    priority: priority.optional(),
    parentId: id.optional(),
    assigneeIds: assigneeIds.optional(),
  }),
  z.object({
    type: z.literal("update-issue"),
    id,
    title: title.optional(),
    description: description.optional(),
    statusId: id.optional(),
    projectId: id.nullable().optional(),
    priority: priority.optional(),
    assigneeIds: assigneeIds.optional(),
  }),
  /** Into a status column, before or after another issue there (or on top). */
  z.object({ type: z.literal("move-issue"), id, statusId: id, targetId: id.optional(), placement: placement.optional() }),
  z.object({ type: z.literal("delete-attachment"), id }),
  // ── Workspace board settings ──
  z.object({ type: z.literal("create-status"), id, workspaceId: id, name: statusName, category: z.enum(statusCategories), color }),
  z.object({ type: z.literal("update-status"), id, name: statusName.optional(), category: z.enum(statusCategories).optional(), color: color.optional() }),
  z.object({ type: z.literal("move-status"), id, targetId: id, placement }),
  /** Its issues move to `replacementId`. */
  z.object({ type: z.literal("delete-status"), id, replacementId: id }),
  z.object({ type: z.literal("create-project"), id, workspaceId: id, name: projectName, description: description.optional(), color }),
  z.object({ type: z.literal("update-project"), id, name: projectName.optional(), description: description.optional(), color: color.optional() }),
  z.object({ type: z.literal("delete-project"), id }),
]);
export type Command = z.infer<typeof commandSchema>;
export function taskStatus(todo: Pick<Todo, "completed" | "inProgress">) {
  return todo.completed ? "done" : todo.inProgress ? "busy" : "open";
}
export function taskStatePatch(command: { completed?: boolean; inProgress?: boolean }) {
  if (command.completed === undefined && command.inProgress === undefined) return {};
  return { completed: command.completed ?? false, inProgress: command.inProgress ?? false };
}
export function sortTodos(items: Todo[]) {
  return [...items].sort(
    (a, b) =>
      (["busy", "open", "done"].indexOf(taskStatus(a)) - ["busy", "open", "done"].indexOf(taskStatus(b))) ||
      (a.position ?? 0) - (b.position ?? 0) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id),
  );
}
export function moveTodo(items: Todo[], command: Extract<Command, { type: "move-todo" }>) {
  const moving = items.find((t) => t.id === command.id);
  const target = items.find((t) => t.id === command.targetId);
  if (!moving || !target || moving.id === target.id || moving.listId !== target.listId || taskStatus(moving) !== taskStatus(target)) return items;
  const ordered = sortTodos(items.filter((t) => t.listId === moving.listId && t.id !== moving.id));
  const index = ordered.findIndex((t) => t.id === target.id);
  ordered.splice(index + Number(command.placement === "after"), 0, moving);
  const positions = new Map(ordered.map((t, position) => [t.id, position]));
  return items.map((t) => positions.has(t.id) ? { ...t, position: positions.get(t.id)! } : t);
}
/** Moves `id` directly before or after `targetId`; unknown ids leave the order unchanged. */
export function reorderIds(ids: string[], id: string, targetId: string, placement: "before" | "after") {
  if (id === targetId || !ids.includes(id) || !ids.includes(targetId)) return ids;
  const rest = ids.filter((other) => other !== id);
  rest.splice(rest.indexOf(targetId) + Number(placement === "after"), 0, id);
  return rest;
}
/** Lists are ordered per kind (the sidebar sections); `data.lists` is in display order. */
export function moveList(lists: TodoList[], command: Extract<Command, { type: "move-list" }>) {
  const moving = lists.find((l) => l.id === command.id);
  const target = lists.find((l) => l.id === command.targetId);
  if (!moving || !target || (moving.kind ?? "todo") !== (target.kind ?? "todo")) return lists;
  const kind = moving.kind ?? "todo";
  const section = lists.filter((l) => (l.kind ?? "todo") === kind);
  const order = reorderIds(section.map((l) => l.id), command.id, command.targetId, command.placement);
  const sorted = order.map((listId) => section.find((l) => l.id === listId)!);
  let next = 0;
  return lists.map((l) => ((l.kind ?? "todo") === kind ? sorted[next++] : l));
}
/** Board columns are in status order; within one, issues are in `position` order. */
export function sortIssues(items: Todo[]) {
  return [...items].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );
}
/** Sub-issues read top to bottom in the order they were added. */
export function sortSubIssues(items: Todo[]) {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
/** The issue and everything below it. */
export function issueWithDescendants(todos: Todo[], id: string) {
  const ids = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const todo of todos)
      if (todo.parentId && ids.has(todo.parentId) && !ids.has(todo.id)) {
        ids.add(todo.id);
        grew = true;
      }
  }
  return ids;
}
/** New positions for a column after `move-issue`; the moving issue gets the new status. */
export function moveIssue(todos: Todo[], command: Extract<Command, { type: "move-issue" }>) {
  const moving = todos.find((t) => t.id === command.id);
  if (!moving) return new Map<string, number>();
  const column = sortIssues(
    todos.filter((t) => t.listId === moving.listId && !t.parentId && t.statusId === command.statusId && t.id !== moving.id),
  );
  const index = command.targetId ? column.findIndex((t) => t.id === command.targetId) : -1;
  column.splice(index < 0 ? 0 : index + Number(command.placement === "after"), 0, moving);
  return new Map(column.map((t, position) => [t.id, position]));
}
function statusById(data: WorkspaceData, id: string | undefined) {
  return (data.statuses ?? []).find((s) => s.id === id);
}

export function optimisticUpdate(data: WorkspaceData, command: Command): WorkspaceData {
  switch (command.type) {
    case "create-issue": {
      if (data.todos.some((t) => t.id === command.id)) return data;
      const status = statusById(data, command.statusId) ?? defaultStatus(data.statuses ?? []);
      const siblings = data.todos.filter((t) => t.listId === command.listId);
      return {
        ...data,
        todos: [
          ...data.todos,
          {
            id: command.id,
            listId: command.listId,
            title: command.title,
            ...statusFlags(status?.category),
            position: Math.min(0, ...siblings.filter((t) => t.statusId === status?.id).map((t) => t.position ?? 0)) - 1,
            createdAt: new Date().toISOString(),
            number: Math.max(0, ...siblings.map((t) => t.number ?? 0)) + 1,
            description: command.description ?? "",
            statusId: status?.id,
            projectId: command.projectId ?? undefined,
            priority: command.priority ?? 0,
            parentId: command.parentId,
            assigneeIds: command.assigneeIds ?? [],
            attachments: [],
          },
        ],
      };
    }
    case "update-issue": {
      const status = statusById(data, command.statusId);
      return {
        ...data,
        todos: data.todos.map((t) =>
          t.id !== command.id
            ? t
            : {
                ...t,
                ...(command.title !== undefined ? { title: command.title } : {}),
                ...(command.description !== undefined ? { description: command.description } : {}),
                ...(status ? { statusId: status.id, ...statusFlags(status.category) } : {}),
                ...(command.projectId !== undefined ? { projectId: command.projectId ?? undefined } : {}),
                ...(command.priority !== undefined ? { priority: command.priority } : {}),
                ...(command.assigneeIds !== undefined ? { assigneeIds: command.assigneeIds } : {}),
              },
        ),
      };
    }
    case "move-issue": {
      const status = statusById(data, command.statusId);
      if (!status) return data;
      const positions = moveIssue(data.todos, command);
      return {
        ...data,
        todos: data.todos.map((t) =>
          t.id === command.id
            ? { ...t, statusId: status.id, ...statusFlags(status.category), position: positions.get(t.id) ?? t.position }
            : positions.has(t.id) ? { ...t, position: positions.get(t.id)! } : t,
        ),
      };
    }
    case "delete-attachment":
      return {
        ...data,
        todos: data.todos.map((t) =>
          t.attachments?.some((a) => a.id === command.id) ? { ...t, attachments: t.attachments.filter((a) => a.id !== command.id) } : t,
        ),
      };
    case "create-status": {
      const statuses = data.statuses ?? [];
      if (statuses.some((s) => s.id === command.id)) return data;
      const position = Math.max(-1, ...statuses.filter((s) => s.category === command.category).map((s) => s.position)) + 1;
      return { ...data, statuses: [...statuses, { id: command.id, name: command.name, category: command.category, color: command.color, position }] };
    }
    case "update-status": {
      const statuses = (data.statuses ?? []).map((s) =>
        s.id !== command.id
          ? s
          : {
              ...s,
              ...(command.name !== undefined ? { name: command.name } : {}),
              ...(command.color !== undefined ? { color: command.color } : {}),
              ...(command.category !== undefined && command.category !== s.category
                ? { category: command.category, position: Math.max(-1, ...(data.statuses ?? []).filter((o) => o.category === command.category).map((o) => o.position)) + 1 }
                : {}),
            },
      );
      const category = statuses.find((s) => s.id === command.id)?.category;
      return {
        ...data,
        statuses,
        todos: command.category ? data.todos.map((t) => (t.statusId === command.id ? { ...t, ...statusFlags(category) } : t)) : data.todos,
      };
    }
    case "move-status": {
      const statuses = data.statuses ?? [];
      const moving = statuses.find((s) => s.id === command.id);
      const target = statuses.find((s) => s.id === command.targetId);
      if (!moving || !target || moving.category !== target.category) return data;
      const order = reorderIds(sortStatuses(statuses.filter((s) => s.category === moving.category)).map((s) => s.id), command.id, command.targetId, command.placement);
      return { ...data, statuses: statuses.map((s) => (order.includes(s.id) ? { ...s, position: order.indexOf(s.id) } : s)) };
    }
    case "delete-status": {
      const replacement = statusById(data, command.replacementId);
      if (!replacement || command.id === command.replacementId) return data;
      return {
        ...data,
        statuses: (data.statuses ?? []).filter((s) => s.id !== command.id),
        todos: data.todos.map((t) => (t.statusId === command.id ? { ...t, statusId: replacement.id, ...statusFlags(replacement.category) } : t)),
      };
    }
    case "create-project": {
      const projects = data.projects ?? [];
      if (projects.some((p) => p.id === command.id)) return data;
      const position = Math.max(-1, ...projects.map((p) => p.position)) + 1;
      return { ...data, projects: [...projects, { id: command.id, name: command.name, description: command.description ?? "", color: command.color, position }] };
    }
    case "update-project":
      return {
        ...data,
        projects: (data.projects ?? []).map((p) =>
          p.id !== command.id
            ? p
            : {
                ...p,
                ...(command.name !== undefined ? { name: command.name } : {}),
                ...(command.description !== undefined ? { description: command.description } : {}),
                ...(command.color !== undefined ? { color: command.color } : {}),
              },
        ),
      };
    case "delete-project":
      return {
        ...data,
        projects: (data.projects ?? []).filter((p) => p.id !== command.id),
        todos: data.todos.map((t) => (t.projectId === command.id ? { ...t, projectId: undefined } : t)),
      };
    case "create-list":
      if (data.lists.some((l) => l.id === command.id)) return data;
      return {
        ...data,
        lists: [
          ...data.lists,
          {
            id: command.id,
            name: command.name,
            ...(command.kind && command.kind !== "todo" ? { kind: command.kind } : {}),
            ...(command.kind === "note" ? { note: { markdown: command.markdown ?? "", version: 0 } } : {}),
            role: "owner",
            createdAt: new Date().toISOString(),
          },
        ],
      };
    case "update-note":
      return { ...data, lists: data.lists.map((list) => list.id === command.id ? { ...list, note: { markdown: command.markdown, version: command.version + 1 } } : list) };
    case "rename-list":
      return {
        ...data,
        lists: data.lists.map((l) =>
          l.id === command.id ? { ...l, name: command.name } : l,
        ),
      };
    case "delete-list":
      return {
        ...data,
        lists: data.lists.filter((l) => l.id !== command.id),
        todos: data.todos.filter((t) => t.listId !== command.id),
      };
    case "create-todo":
      if (data.todos.some((t) => t.id === command.id)) return data;
      return {
        ...data,
        todos: [
          ...data.todos,
          {
            id: command.id,
            listId: command.listId,
            title: command.title,
            completed: false,
            position: Math.min(0, ...data.todos.filter((t) => t.listId === command.listId).map((t) => t.position ?? 0)) - 1,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    case "update-todo":
      return {
        ...data,
        todos: data.todos.map((t) =>
          t.id === command.id
            ? {
                ...t,
                ...(command.title !== undefined
                  ? { title: command.title }
                  : {}),
                ...taskStatePatch(command),
              }
            : t,
        ),
      };
    case "move-todo":
      return { ...data, todos: moveTodo(data.todos, command) };
    case "move-list":
      return { ...data, lists: moveList(data.lists, command) };
    case "delete-todo": {
      const gone = issueWithDescendants(data.todos, command.id);
      return { ...data, todos: data.todos.filter((t) => !gone.has(t.id)) };
    }
    case "clear-done":
      return { ...data, todos: data.todos.filter((t) => t.listId !== command.listId || !t.completed) };
  }
}
