// Advanced boards (list kind "board"): Linear-style issues with statuses,
// projects, priority, assignees, sub-issues and attachments. Statuses and
// projects belong to the workspace and are shared by all its boards.

export const statusCategories = ["backlog", "unstarted", "started", "completed", "canceled"] as const;
export type StatusCategory = (typeof statusCategories)[number];

export type BoardStatus = { id: string; name: string; category: StatusCategory; color: string; position: number };
export type BoardProject = { id: string; name: string; description: string; color: string; position: number };
export type BoardMember = { id: string; name: string; email: string; image: string | null };
export type TodoAttachment = { id: string; name: string; contentType: string; size: number; createdAt: string };

/** 0 none, 1 urgent, 2 high, 3 medium, 4 low (Linear's order). */
export const priorities = [0, 1, 2, 3, 4] as const;
export type Priority = (typeof priorities)[number];

/** A file on an issue may be at most this large; it is sent in chunks. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_CHUNK_BYTES = 2 * 1024 * 1024;

export const statusColors = ["#95a2b3", "#a1a1aa", "#f2c94c", "#5e6ad2", "#4cb782", "#eb5757", "#f2994a", "#26b5ce", "#bb87fc"];
export const projectColors = ["#5e6ad2", "#26b5ce", "#4cb782", "#f2c94c", "#f2994a", "#eb5757", "#bb87fc", "#95a2b3"];

export const defaultStatuses: { name: Record<"en" | "nl", string>; category: StatusCategory; color: string }[] = [
  { name: { en: "Backlog", nl: "Backlog" }, category: "backlog", color: "#95a2b3" },
  { name: { en: "Todo", nl: "Te doen" }, category: "unstarted", color: "#a1a1aa" },
  { name: { en: "In Progress", nl: "Bezig" }, category: "started", color: "#f2c94c" },
  { name: { en: "In Review", nl: "In review" }, category: "started", color: "#4cb782" },
  { name: { en: "Done", nl: "Klaar" }, category: "completed", color: "#5e6ad2" },
  { name: { en: "Canceled", nl: "Geannuleerd" }, category: "canceled", color: "#95a2b3" },
];

export const sortStatuses = (statuses: BoardStatus[]) =>
  [...statuses].sort(
    (a, b) =>
      statusCategories.indexOf(a.category) - statusCategories.indexOf(b.category) ||
      a.position - b.position ||
      a.id.localeCompare(b.id),
  );

/** Where a new issue starts: the first "unstarted" status, else the first one. */
export function defaultStatus(statuses: BoardStatus[]) {
  const sorted = sortStatuses(statuses);
  return sorted.find((s) => s.category === "unstarted") ?? sorted[0];
}

/** Simple-list flags kept in sync with an issue's status, so counts work everywhere. */
export function statusFlags(category: StatusCategory | undefined) {
  return {
    completed: category === "completed" || category === "canceled",
    inProgress: category === "started",
  };
}

/** The status a simple "done / busy / open" change maps to on a board. */
export function statusForFlags(statuses: BoardStatus[], flags: { completed: boolean; inProgress: boolean }) {
  const category: StatusCategory = flags.completed ? "completed" : flags.inProgress ? "started" : "unstarted";
  return sortStatuses(statuses).find((s) => s.category === category) ?? defaultStatus(statuses);
}
