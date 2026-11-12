import { describe, expect, it } from "vitest";
import { commandSchema, optimisticUpdate, sortIssues, type WorkspaceData } from "../src/workspace";
import { defaultStatus, statusForFlags, type BoardStatus } from "../src/board";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const statuses: BoardStatus[] = [
  { id: id(101), name: "Backlog", category: "backlog", color: "#95a2b3", position: 0 },
  { id: id(102), name: "Todo", category: "unstarted", color: "#e2e2e2", position: 1 },
  { id: id(103), name: "In Progress", category: "started", color: "#f2c94c", position: 2 },
  { id: id(104), name: "Done", category: "completed", color: "#5e6ad2", position: 3 },
];
const board = id(1);
const issue = (n: number, statusId: string, position: number) => ({
  id: id(n), listId: board, title: `Issue ${n}`, completed: false, position, createdAt: "2026-01-01",
  number: n, description: "", statusId, priority: 0, assigneeIds: [], attachments: [],
});
const data: WorkspaceData = {
  lists: [{ id: board, name: "Website", kind: "board", createdAt: "2026-01-01", role: "owner" }],
  todos: [issue(10, id(102), 0), issue(11, id(102), 1), issue(12, id(103), 0)],
  statuses,
  projects: [{ id: id(201), name: "Launch", description: "", color: "#5e6ad2", position: 0 }],
  members: [],
};

describe("boards", () => {
  it("starts new issues in the first unstarted status with the next number", () => {
    expect(defaultStatus(statuses)?.id).toBe(id(102));
    const next = optimisticUpdate(data, { type: "create-issue", id: id(13), listId: board, title: "New" });
    const created = next.todos.find((t) => t.id === id(13))!;
    expect(created).toMatchObject({ statusId: id(102), number: 13, completed: false });
  });

  it("moves an issue into another column at the given spot and syncs done flags", () => {
    const moved = optimisticUpdate(data, { type: "move-issue", id: id(10), statusId: id(103), targetId: id(12), placement: "after" });
    const column = sortIssues(moved.todos.filter((t) => t.statusId === id(103))).map((t) => t.id);
    expect(column).toEqual([id(12), id(10)]);
    expect(moved.todos.find((t) => t.id === id(10))).toMatchObject({ inProgress: true, completed: false });
    const done = optimisticUpdate(data, { type: "update-issue", id: id(11), statusId: id(104) });
    expect(done.todos.find((t) => t.id === id(11))?.completed).toBe(true);
  });

  it("deletes sub-issues with their parent", () => {
    const withChild = optimisticUpdate(data, { type: "create-issue", id: id(20), listId: board, title: "Child", parentId: id(10) });
    const grandchild = optimisticUpdate(withChild, { type: "create-issue", id: id(21), listId: board, title: "Grandchild", parentId: id(20) });
    const after = optimisticUpdate(grandchild, { type: "delete-todo", id: id(10) });
    expect(after.todos.map((t) => t.id)).toEqual([id(11), id(12)]);
  });

  it("moves issues to the replacement when a status is deleted", () => {
    const after = optimisticUpdate(data, { type: "delete-status", id: id(102), replacementId: id(104) });
    expect(after.statuses?.some((s) => s.id === id(102))).toBe(false);
    expect(after.todos.filter((t) => t.statusId === id(104) && t.completed)).toHaveLength(2);
  });

  it("clears the project from issues when it is deleted", () => {
    const tagged = optimisticUpdate(data, { type: "update-issue", id: id(10), projectId: id(201) });
    expect(tagged.todos[0].projectId).toBe(id(201));
    expect(optimisticUpdate(tagged, { type: "delete-project", id: id(201) }).todos[0].projectId).toBeUndefined();
  });

  it("maps simple done/busy changes to a status", () => {
    expect(statusForFlags(statuses, { completed: true, inProgress: false })?.id).toBe(id(104));
    expect(statusForFlags(statuses, { completed: false, inProgress: true })?.id).toBe(id(103));
  });

  it("validates board commands", () => {
    expect(commandSchema.safeParse({ type: "create-status", id: id(1), workspaceId: id(2), name: "QA", category: "started", color: "#123abc" }).success).toBe(true);
    expect(commandSchema.safeParse({ type: "create-status", id: id(1), workspaceId: id(2), name: "QA", category: "doing", color: "#123abc" }).success).toBe(false);
    expect(commandSchema.safeParse({ type: "update-issue", id: id(1), priority: 5 }).success).toBe(false);
    expect(commandSchema.safeParse({ type: "create-list", id: id(1), workspaceId: id(2), name: "Bord", kind: "board" }).success).toBe(true);
  });
});

describe("assignees", () => {
  it("accept Better Auth user ids", () => {
    expect(commandSchema.safeParse({ type: "update-issue", id: id(1), assigneeIds: ["Zhf2K7IoU5vymB9KkQUiWQgS9a1hi4fF"] }).success).toBe(true);
  });
});
