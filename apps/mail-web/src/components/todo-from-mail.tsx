import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ArrowUpRight01Icon, CheckmarkSquare02Icon, SquareIcon, TaskDone01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@evido/ui/components/dialog"
import { Input } from "@evido/ui/components/input"
import { Label } from "@evido/ui/components/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@evido/ui/components/select"
import { cn } from "@evido/ui/lib/utils"
import type { MailTodoList, MailTodoView } from "@evido/mail-core/types"
import { useI18n } from "@/i18n"
import { errorText } from "@/lib/api"
import { useTodos } from "@/lib/preferences"
import {
  lastTodoList,
  rememberTodoList,
  useConversationTodos,
  useCreateTodo,
  useTodoLists,
} from "@/lib/todos"

/** Opens Even doen at the task's list, beside the mail. */
const openTodo = (url: string) => window.open(url, "_blank", "noopener,noreferrer")

/** Lists per workspace, in Even doen's order; workspaces only named when there are several. */
function groupByWorkspace(lists: MailTodoList[]) {
  const groups = new Map<string, { name: string; lists: MailTodoList[] }>()
  for (const list of lists) {
    const group = groups.get(list.workspaceId)
    if (group) group.lists.push(list)
    else groups.set(list.workspaceId, { name: list.workspaceName, lists: [list] })
  }
  return [...groups.values()]
}

/**
 * A task in Even doen from this mail: its subject as the title, ready to
 * change, and the list it goes to, the last one used unless picked otherwise.
 * The task keeps a link back to the mail.
 */
export function TodoDialog({
  threadId,
  subject,
  open,
  onOpenChange,
}: {
  threadId: string
  subject: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useI18n().t.todos
  const lists = useTodoLists(open)
  const create = useCreateTodo(threadId)
  const [title, setTitle] = useState(subject)
  const [listId, setListId] = useState("")
  const input = useRef<HTMLInputElement>(null)
  const available = lists.data?.lists ?? []
  const groups = groupByWorkspace(available)

  useEffect(() => {
    if (open) setTitle(subject)
  }, [open, subject])
  // The last list used, while it still exists; otherwise the first.
  useEffect(() => {
    if (!available.length || available.some((list) => list.id === listId)) return
    const last = lastTodoList()
    setListId(available.find((list) => list.id === last)?.id ?? available[0].id)
  }, [available, listId])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const name = title.trim()
    if (!name || !listId || create.isPending) return
    rememberTodoList(listId)
    create.mutate(
      { listId, title: name },
      {
        onSuccess: ({ todo }) => {
          onOpenChange(false)
          toast.success(t.created(todo.listName), { action: { label: t.open, onClick: () => openTodo(todo.url) } })
        },
        onError: (error) => toast.error(errorText(error)),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          input.current?.select()
        }}
      >
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="todo-title">{t.task}</Label>
            <Input
              ref={input}
              id="todo-title"
              value={title}
              maxLength={500}
              autoComplete="off"
              data-1p-ignore
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="todo-list">{t.list}</Label>
            {lists.isSuccess && available.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noLists}</p>
            ) : (
              <Select value={listId} onValueChange={setListId} disabled={!lists.isSuccess}>
                <SelectTrigger id="todo-list" className="w-full">
                  <SelectValue placeholder={lists.isPending ? t.loadingLists : undefined} />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  {groups.map((group) => (
                    <SelectGroup key={group.name}>
                      {groups.length > 1 && <SelectLabel>{group.name}</SelectLabel>}
                      {group.lists.map((list) => (
                        <SelectItem key={list.id} value={list.id}>
                          {list.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={!title.trim() || !listId || create.isPending}>
              {t.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function StatusIcon({ todo }: { todo: MailTodoView }) {
  return (
    <HugeiconsIcon
      icon={todo.completed ? CheckmarkSquare02Icon : todo.inProgress ? TaskDone01Icon : SquareIcon}
      strokeWidth={1.75}
      aria-hidden="true"
      className={cn("size-4 shrink-0", todo.completed ? "text-muted-foreground" : "text-foreground")}
    />
  )
}

/** Above the mail: the tasks made from it, where they stand, each opening in Even doen. */
export function LinkedTodos({ threadId }: { threadId: string }) {
  const t = useI18n().t.todos
  const enabled = useTodos()
  const { data } = useConversationTodos(threadId, enabled)
  const todos = data?.todos ?? []
  if (!enabled || todos.length === 0) return null
  return (
    <section className="mb-3 flex flex-col rounded-xl border bg-muted/40 p-1" aria-label={t.linked}>
      {todos.map((todo) => (
        <a
          key={todo.id}
          href={todo.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors outline-none hover:bg-accent/60 focus-visible:bg-accent"
        >
          <StatusIcon todo={todo} />
          <span className={cn("min-w-0 flex-1 truncate", todo.completed && "text-muted-foreground line-through")}>
            {todo.title}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {todo.completed ? t.done : todo.inProgress ? t.busy : todo.listName}
          </span>
          <HugeiconsIcon
            icon={ArrowUpRight01Icon}
            strokeWidth={1.75}
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
          <span className="sr-only">{t.openInTodo}</span>
        </a>
      ))}
    </section>
  )
}
