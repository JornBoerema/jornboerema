import { describe, expect, it } from "vitest";
import {
  commandSchema,
  optimisticUpdate,
  sortTodos,
  type WorkspaceData,
} from "../src/workspace";
const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
];
const data: WorkspaceData = {
  lists: [{ id: ids[0], name: "Werk", createdAt: "2026-01-01", role: "owner" }],
  todos: [
    {
      id: ids[0],
      listId: ids[0],
      title: "Eerste taak",
      completed: false,
      createdAt: "2026-01-01",
    },
    {
      id: ids[1],
      listId: ids[0],
      title: "Tweede taak",
      completed: false,
      createdAt: "2026-01-02",
    },
  ],
};
describe("task ordering and realtime reconciliation", () => {
  it("shows newest tasks first while keeping completed tasks below open tasks", () => {
    expect(sortTodos(data.todos).map((t) => t.id)).toEqual([ids[1], ids[0]]);
    const updated = optimisticUpdate(data, {
      type: "update-todo",
      id: ids[1],
      completed: true,
    });
    expect(sortTodos(updated.todos).map((t) => t.id)).toEqual(ids);
    const reopened = optimisticUpdate(updated, {
      type: "update-todo",
      id: ids[1],
      completed: false,
    });
    expect(sortTodos(reopened.todos).map((t) => t.id)).toEqual([
      ids[1],
      ids[0],
    ]);
    expect(data.todos[1].completed).toBe(false);
  });
  it("persists manual order, keeps completion groups separate and prepends new tasks", () => {
    const moved = optimisticUpdate(data, { type: "move-todo", id: ids[0], targetId: ids[1], placement: "before" });
    expect(sortTodos(moved.todos).map((t) => t.id)).toEqual(ids);
    const added = optimisticUpdate(moved, { type: "create-todo", id: "00000000-0000-4000-8000-000000000003", listId: ids[0], title: "Nieuw" });
    expect(sortTodos(added.todos)[0].title).toBe("Nieuw");
    const done = optimisticUpdate(moved, { type: "update-todo", id: ids[0], completed: true });
    const invalid = optimisticUpdate(done, { type: "move-todo", id: ids[0], targetId: ids[1], placement: "before" });
    expect(invalid.todos).toEqual(done.todos);
    expect(sortTodos(done.todos).map((t) => t.id)).toEqual([ids[1], ids[0]]);
  });
  it("cycles open, busy and done without marking busy tasks complete", () => {
    const busy = optimisticUpdate(data, { type: "update-todo", id: ids[0], inProgress: true });
    expect(busy.todos[0]).toMatchObject({ completed: false, inProgress: true });
    expect(sortTodos(busy.todos).map((t) => t.id)).toEqual(ids);
    const edited = optimisticUpdate(busy, { type: "update-todo", id: ids[0], title: "Bezig" });
    expect(edited.todos[0].inProgress).toBe(true);
    const done = optimisticUpdate(edited, { type: "update-todo", id: ids[0], completed: true });
    expect(done.todos[0]).toMatchObject({ completed: true, inProgress: false });
    const reopened = optimisticUpdate(done, { type: "update-todo", id: ids[0], completed: false });
    expect(reopened.todos[0]).toMatchObject({ completed: false, inProgress: false });
    expect(commandSchema.safeParse({ type: "update-todo", id: ids[0], completed: true, inProgress: true }).success).toBe(false);
  });
  it("does not duplicate a created item when realtime refetch arrives before mutation settles", () => {
    expect(
      optimisticUpdate(data, {
        type: "create-todo",
        id: ids[0],
        listId: ids[0],
        title: "Eerste taak",
      }).todos,
    ).toHaveLength(2);
    expect(
      optimisticUpdate(data, { type: "create-list", id: ids[0], workspaceId: ids[1], name: "Werk" })
        .lists,
    ).toHaveLength(1);
  });
  it("accepts initial Markdown only for notes and includes it in optimistic state", () => {
    const command = commandSchema.parse({ type: "create-list", id: ids[1], workspaceId: ids[0], name: "Ideeën", kind: "note", markdown: "# Idee" });
    expect(optimisticUpdate(data, command).lists[1].note).toEqual({ markdown: "# Idee", version: 0 });
    for (const kind of ["todo", undefined]) {
      expect(commandSchema.safeParse({ ...command, kind }).success).toBe(false);
    }
    expect(commandSchema.safeParse({ ...command, markdown: "x".repeat(100001) }).success).toBe(false);
  });
  it("rejects blank, oversized and malformed commands", () => {
    for (const input of [
      { type: "create-list", id: ids[0], name: "   " },
      {
        type: "create-todo",
        id: ids[0],
        listId: ids[1],
        title: "x".repeat(501),
      },
      { type: "update-todo", id: ids[0] },
      { type: "delete-list", id: "not-a-uuid" },
    ])
      expect(commandSchema.safeParse(input).success).toBe(false);
  });
});

import { canManageWorkspace, workspaceCommand } from "../src/workspaces";
describe("workspaces", () => {
  const id = "00000000-0000-4000-8000-000000000003";
  it("never assigns ownership through invites or role changes", () => {
    expect(workspaceCommand.safeParse({ type: "invite", workspaceId: id, email: "a@b.nl", role: "owner" }).success).toBe(false);
    expect(workspaceCommand.safeParse({ type: "update-member", workspaceId: id, memberId: id, role: "owner" }).success).toBe(false);
    expect(workspaceCommand.parse({ type: "invite", workspaceId: id, email: " A@B.nl ", role: "member" })).toMatchObject({ email: "a@b.nl" });
  });
  it("lets owners and admins manage, not members", () => {
    expect([canManageWorkspace("owner"), canManageWorkspace("admin"), canManageWorkspace("member")]).toEqual([true, true, false]);
  });
  it("requires a workspace name", () => {
    expect(workspaceCommand.safeParse({ type: "create", id, name: "  " }).success).toBe(false);
  });
});

import { moveList, reorderIds, type TodoList } from "../src/workspace";
describe("list order", () => {
  const ids = ["a", "b", "c", "d"];
  it("moves an id before or after a target", () => {
    expect(reorderIds(ids, "d", "a", "before")).toEqual(["d", "a", "b", "c"]);
    expect(reorderIds(ids, "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
    expect(reorderIds(ids, "a", "x", "after")).toEqual(ids);
  });
  it("reorders only within the same kind and keeps other sections in place", () => {
    const list = (id: string, kind?: "note"): TodoList => ({ id, name: id, kind, createdAt: "", role: "owner" });
    const lists = [list("t1"), list("n1", "note"), list("t2"), list("t3"), list("n2", "note")];
    const u = (s: string) => s; // ids are opaque here
    expect(moveList(lists, { type: "move-list", id: u("t3"), targetId: u("t1"), placement: "before" }).map((l) => l.id))
      .toEqual(["t3", "n1", "t1", "t2", "n2"]);
    expect(moveList(lists, { type: "move-list", id: u("t1"), targetId: u("n1"), placement: "before" })).toBe(lists);
  });
});
