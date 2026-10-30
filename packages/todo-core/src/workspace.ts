import { z } from "zod";
export type TodoList = {
  id: string;
  name: string;
  kind?: "todo" | "note";
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
};
export type WorkspaceData = { lists: TodoList[]; todos: Todo[] };
const id = z.string().uuid();
const listName = z.string().trim().min(1, "Geef je lijst een naam.").max(80);
const title = z.string().trim().min(1, "Vul een taak in.").max(500);
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("update-note"), id, markdown: z.string().max(100000, "Een notitie mag maximaal 100.000 tekens bevatten."), version: z.number().int().min(0) }),
  z.object({ type: z.literal("create-list"), id, workspaceId: id, name: listName, kind: z.enum(["todo", "note"]).optional(), markdown: z.string().max(100000).optional() }).refine((value) => value.markdown === undefined || value.kind === "note", "Inhoud is alleen beschikbaar voor notities."),
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
  z.object({ type: z.literal("move-todo"), id, targetId: id, placement: z.enum(["before", "after"]) }),
  z.object({ type: z.literal("move-list"), id, targetId: id, placement: z.enum(["before", "after"]) }),
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
export function optimisticUpdate(data: WorkspaceData, command: Command): WorkspaceData {
  switch (command.type) {
    case "create-list":
      if (data.lists.some((l) => l.id === command.id)) return data;
      return {
        ...data,
        lists: [
          ...data.lists,
          {
            id: command.id,
            name: command.name,
            ...(command.kind ? { kind: command.kind } : {}),
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
    case "delete-todo":
      return { ...data, todos: data.todos.filter((t) => t.id !== command.id) };
  }
}
