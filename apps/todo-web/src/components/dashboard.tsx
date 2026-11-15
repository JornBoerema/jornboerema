import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MailScheduledView, MailSnoozedView, MailThreadsPage, MailThreadView } from "@even/mail-core/types";
import { useAppSwitcher } from "@even/ui/components/app-switcher";
import { Button } from "@even/ui/components/button";
import { Checkbox } from "@even/ui/components/checkbox";
import { useOrganizations } from "@even/ui/components/organizations";
import { Skeleton } from "@even/ui/components/skeleton";
import { cn } from "@even/ui/lib/utils";
import { sortTodos, type Todo, type WorkspaceData } from "@even/todo-core/workspace";
import type { WorkspaceSummary } from "@even/todo-core/workspaces";
import { PageError } from "@/components/page-error";
import { PageLoading } from "@/components/page-loading";
import { useWorkspace } from "@/hooks/use-workspace";
import { apiFetch } from "@/lib/api";
import { RequireSession, type SessionUser } from "@/lib/session";
import { useI18n } from "@/i18n";

const INBOX_ROWS = 9;
const SIDE_ROWS = 4;
const NOTES = 3;
const MAIL_KEY = ["dashboard-mail"];

/** First meaningful line of a note, without Markdown and without repeating its title. */
function excerpt(markdown: string, title: string) {
  const plain = (line: string) =>
    line.trim().replace(/^(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s+|\d+\.\s+)/, "").replace(/[*_`~]/g, "").trim();
  const same = (line: string) => line.toLocaleLowerCase() === title.trim().toLocaleLowerCase();
  return markdown.split("\n").map(plain).find((line) => line && !same(line)) ?? "";
}

async function getJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Even mailen's API answers 403 to people it isn't open to yet; that is a state, not an error. */
class NoMailAccess extends Error {}

async function getMail<T>(path: string): Promise<T> {
  const response = await apiFetch(`/api/mail${path}`);
  if (response.status === 403) throw new NoMailAccess();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

type DashboardMail =
  | { state: "no-access" }
  | { state: "no-mailbox" }
  | {
      state: "ready";
      unread: number;
      threads: MailThreadView[];
      snoozed: MailSnoozedView[];
      scheduled: MailScheduledView[];
    };

/** The inbox, what comes back from snooze and what waits to be sent, in one go. */
async function loadMail(): Promise<DashboardMail> {
  try {
    const { accounts } = await getMail<{ accounts: { status: string }[] }>("/accounts");
    if (!accounts.length) return { state: "no-mailbox" };
    const [unread, page, snoozes, scheduled] = await Promise.all([
      getMail<{ count: number }>("/unread"),
      getMail<MailThreadsPage>("/threads"),
      getMail<{ snoozed: MailSnoozedView[] }>("/snoozes"),
      getMail<{ scheduled: MailScheduledView[] }>("/scheduled"),
    ]);
    return {
      state: "ready",
      unread: unread.count,
      // Unread first, each part newest first, as the eye wants to work through it.
      threads: [...page.threads.filter((t) => !t.isRead), ...page.threads.filter((t) => t.isRead)].slice(0, INBOX_ROWS),
      snoozed: [...snoozes.snoozed].sort((a, b) => a.until.localeCompare(b.until)),
      scheduled: scheduled.scheduled,
    };
  } catch (error) {
    if (error instanceof NoMailAccess) return { state: "no-access" };
    throw error;
  }
}

/**
 * The dashboard at the head of the Even rail. Mail comes first: what is unread,
 * what comes back and what goes out; the active organization's tasks and notes
 * follow, small. Everything opens in the app it belongs to.
 */
export function DashboardPage() {
  return <RequireSession>{(user) => <Workspaces user={user} />}</RequireSession>;
}

/** The organization picked in the rail; the dashboard only lives in the Even shell. */
function Workspaces({ user }: { user: SessionUser }) {
  const organizations = useOrganizations();
  if (!organizations) return <PageLoading />;
  return <ActiveWorkspace user={user} active={organizations.active} />;
}

function ActiveWorkspace({ user, active }: { user: SessionUser; active: WorkspaceSummary }) {
  const workspace = useQuery({
    queryKey: ["workspace", user.id, active.id],
    queryFn: () => getJson<WorkspaceData>(`/api/workspace?workspaceId=${encodeURIComponent(active.id)}`),
  });
  const config = useQuery({
    queryKey: ["api-config"],
    queryFn: () => getJson<{ realtime: boolean }>("/api/config"),
    staleTime: Infinity,
  });
  if (workspace.isError) return <PageError onRetry={() => void workspace.refetch()} />;
  if (!workspace.data || config.isPending) return <PageLoading />;
  return (
    <Dashboard
      key={active.id}
      user={user}
      workspace={active}
      initialData={workspace.data}
      realtimeEnabled={!!config.data?.realtime}
    />
  );
}

/** Today: 14:05. Within the week: the weekday. Older: the date. */
function useWhen() {
  const { locale } = useI18n();
  return (iso: string) => {
    const date = new Date(iso);
    const now = new Date();
    if (date.toDateString() === now.toDateString())
      return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
    if (now.getTime() - date.getTime() < 6 * 86400000)
      return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date);
  };
}

/** A moment ahead: "Today 14:00", "Tomorrow 09:00", or the weekday and time. */
function useAhead() {
  const { locale, t: { workspace: { dashboard: t } } } = useI18n();
  return (iso: string) => {
    const date = new Date(iso);
    const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
    const day = new Date();
    if (date.toDateString() === day.toDateString()) return t.today(time);
    day.setDate(day.getDate() + 1);
    if (date.toDateString() === day.toDateString()) return t.tomorrow(time);
    return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  };
}

function Dashboard({ user, workspace, initialData, realtimeEnabled }: {
  user: SessionUser; workspace: WorkspaceSummary; initialData: WorkspaceData; realtimeEnabled: boolean;
}) {
  const { t: { workspace: wt }, locale } = useI18n();
  const t = wt.dashboard;
  const { data, run, online } = useWorkspace(user.id, workspace.id, initialData, realtimeEnabled);
  const switcher = useAppSwitcher();
  const client = useQueryClient();
  const mail = useQuery({ queryKey: MAIL_KEY, queryFn: loadMail, refetchInterval: 60_000, retry: 1 });
  const inFront = switcher?.active === "dashboard";
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 60000);
    return () => window.clearInterval(timer);
  }, []);
  // Back in front: the title, and mail as it is now (it moved on while the inbox was open).
  useEffect(() => {
    if (!inFront) return;
    document.title = `${t.title} · Even`;
    void client.invalidateQueries({ queryKey: MAIL_KEY });
  }, [inFront, t.title, client]);

  const hour = now?.getHours();
  const greeting = hour === undefined ? t.welcome : hour < 12 ? t.morning : hour < 18 ? t.afternoon : t.evening;
  const firstName = user.name.trim().split(/\s+/)[0];

  const open = (app: string, query: Record<string, string>) => switcher?.open?.(app, `/?${new URLSearchParams(query)}`);
  const openThread = (thread: MailThreadView) =>
    open("mail", { open: thread.id, account: thread.accountId, subject: thread.subject });
  const inWorkspace = (key: string, id?: string) => ({ workspace: workspace.id, ...(id ? { [key]: id } : {}) });

  const ready = mail.data?.state === "ready" ? mail.data : null;
  const today = now?.toDateString();
  const returningToday = ready?.snoozed.filter((s) => new Date(s.until).toDateString() === today).length ?? 0;
  const briefing = ready
    ? [
        ready.unread ? t.unread(ready.unread) : t.inboxZero,
        returningToday ? t.returning(returningToday) : "",
        ready.scheduled.length ? t.scheduledCount(ready.scheduled.length) : "",
      ].filter(Boolean)
    : [];

  const taskLists = new Set(data.lists.filter((list) => (list.kind ?? "todo") !== "note").map((list) => list.id));
  const busy = sortTodos(data.todos.filter((item) => taskLists.has(item.listId) && item.inProgress && !item.completed));
  const notes = data.lists.filter((list) => list.kind === "note").slice(0, NOTES);
  const listName = (id: string) => data.lists.find((list) => list.id === id)?.name ?? "";
  // Same cycle as in a list: in progress → done.
  const finish = (todo: Todo) => void run({ type: "update-todo", id: todo.id, completed: true, inProgress: false });

  return <main className="workspace-main dashboard-page">
    <div className="task-content dashboard-content scroll-fade">
      <div className="dash">
        <header className="dash-heading">
          <h1>{greeting}{firstName ? `, ${firstName}` : ""}.</h1>
          <p>
            {now && <span>{new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(now)}</span>}
            {briefing.map((line) => <span key={line}>{line}</span>)}
          </p>
        </header>

        <div className="dash-mail">
          <section className="dash-inbox" aria-labelledby="dash-inbox">
            <div className="dash-section-head">
              <h2 id="dash-inbox">{t.inbox}{ready && ready.unread > 0 && <span className="dash-count">{ready.unread.toLocaleString(locale)}</span>}</h2>
              {ready && <Button variant="ghost" size="sm" onClick={() => open("mail", { view: "inbox" })}>{t.openInbox}</Button>}
            </div>
            {mail.isPending ? <RowsLoading rows={6} /> : mail.isError ? (
              <MailNotice title={t.mailFailed} action={t.retry} onAction={() => void mail.refetch()} />
            ) : mail.data.state === "no-mailbox" ? (
              <MailNotice title={t.noMailbox} body={t.noMailboxBody} action={t.openMail} onAction={() => open("mail", { view: "inbox" })} primary />
            ) : mail.data.state === "no-access" ? (
              <MailNotice title={t.noAccess} body={t.noAccessBody} action={t.openMail} onAction={() => open("mail", { view: "inbox" })} />
            ) : mail.data.threads.length ? (
              <ul className="dash-threads">
                {mail.data.threads.map((thread) => <li key={thread.id}><ThreadRow thread={thread} onOpen={() => openThread(thread)} /></li>)}
              </ul>
            ) : <p className="dash-empty">{t.inboxEmpty}</p>}
          </section>

          {ready && <aside className="dash-later">
            <section aria-labelledby="dash-returning">
              <div className="dash-section-head">
                <h2 id="dash-returning">{t.returningTitle}</h2>
              </div>
              {ready.snoozed.length ? <ul className="dash-side-list">
                {ready.snoozed.slice(0, SIDE_ROWS).map((item) => (
                  <li key={item.thread.id}><SideRow when={item.until} title={item.thread.subject || t.noSubject} detail={item.thread.fromName ?? item.thread.fromEmail ?? t.unknownSender} onOpen={() => open("mail", { view: "snoozed" })} /></li>
                ))}
              </ul> : <p className="dash-empty">{t.returningEmpty}</p>}
            </section>
            <section aria-labelledby="dash-scheduled">
              <div className="dash-section-head">
                <h2 id="dash-scheduled">{t.scheduledTitle}</h2>
              </div>
              {ready.scheduled.length ? <ul className="dash-side-list">
                {ready.scheduled.slice(0, SIDE_ROWS).map((item) => (
                  <li key={item.id}><SideRow when={item.sendAt} failed={item.failed} title={item.subject || t.noSubject} detail={t.to(item.to.map((to) => to.name ?? to.email).join(", "))} onOpen={() => open("mail", { view: "scheduled" })} /></li>
                ))}
              </ul> : <p className="dash-empty">{t.scheduledEmpty}</p>}
            </section>
          </aside>}
        </div>

        <div className="dash-work">
          <section aria-labelledby="dash-busy">
            <div className="dash-section-head">
              <h2 id="dash-busy">{t.inProgress}</h2>
              <Button variant="ghost" size="sm" onClick={() => open("todo", inWorkspace("list"))}>{t.openTodo}</Button>
            </div>
            {busy.length ? <ul className="dash-side-list">
              {busy.slice(0, SIDE_ROWS).map((todo) => (
                <li key={todo.id} className="dash-task">
                  <Checkbox checked="indeterminate" onCheckedChange={() => finish(todo)} disabled={!online} aria-label={wt.task.checkboxLabel(todo.title, "busy")} />
                  <button type="button" className="dash-row-body" onClick={() => open("todo", inWorkspace("list", todo.listId))}>
                    <span className="dash-row-title">{todo.title}</span>
                    <span className="dash-row-detail">{listName(todo.listId)}</span>
                  </button>
                </li>
              ))}
            </ul> : <p className="dash-empty">{t.inProgressEmpty}</p>}
          </section>
          <section aria-labelledby="dash-notes">
            <div className="dash-section-head">
              <h2 id="dash-notes">{t.notes}</h2>
              <Button variant="ghost" size="sm" onClick={() => open("notes", inWorkspace("note"))}>{t.openNotes}</Button>
            </div>
            {notes.length ? <ul className="dash-side-list">
              {notes.map((note) => (
                <li key={note.id}>
                  <button type="button" className="dash-row dash-row-body" onClick={() => open("notes", inWorkspace("note", note.id))}>
                    <span className="dash-row-title">{note.name}</span>
                    <span className="dash-row-detail">{excerpt(note.note?.markdown ?? "", note.name) || t.emptyNote}</span>
                  </button>
                </li>
              ))}
            </ul> : <p className="dash-empty">{t.notesEmpty}</p>}
          </section>
        </div>
      </div>
    </div>
  </main>;
}

/** One conversation: who, what and when; unread ones stand out by weight and a dot. */
function ThreadRow({ thread, onOpen }: { thread: MailThreadView; onOpen: () => void }) {
  const { t: { workspace: { dashboard: t } } } = useI18n();
  const when = useWhen();
  return <button type="button" className={cn("dash-thread", !thread.isRead && "is-unread")} onClick={onOpen}>
    <span className="dash-thread-dot" aria-hidden="true" />
    <span className="dash-thread-from">{thread.fromName || thread.fromEmail || t.unknownSender}</span>
    <span className="dash-thread-text">
      <span className="dash-thread-subject">{thread.subject || t.noSubject}</span>
      {thread.snippet && <span className="dash-thread-snippet">{thread.snippet}</span>}
    </span>
    <time className="dash-thread-when" dateTime={thread.receivedAt}>{when(thread.receivedAt)}</time>
    {!thread.isRead && <span className="sr-only">{t.unreadMark}</span>}
  </button>;
}

function SideRow({ when, title, detail, failed = false, onOpen }: {
  when: string; title: string; detail: string; failed?: boolean; onOpen: () => void;
}) {
  const { t: { workspace: { dashboard: t } } } = useI18n();
  const ahead = useAhead();
  return <button type="button" className="dash-row dash-row-body" onClick={onOpen}>
    <span className={cn("dash-row-when", failed && "is-failed")}>{failed ? t.scheduledFailed : ahead(when)}</span>
    <span className="dash-row-title">{title}</span>
    <span className="dash-row-detail">{detail}</span>
  </button>;
}

function MailNotice({ title, body, action, onAction, primary = false }: {
  title: string; body?: string; action: string; onAction: () => void; primary?: boolean;
}) {
  return <div className="dash-notice">
    <p className="dash-notice-title">{title}</p>
    {body && <p className="dash-notice-body">{body}</p>}
    <Button size="sm" variant={primary ? "default" : "outline"} onClick={onAction}>{action}</Button>
  </div>;
}

function RowsLoading({ rows }: { rows: number }) {
  return <div className="flex flex-col gap-3 py-2" aria-hidden="true">
    {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-9 w-full" />)}
  </div>;
}
