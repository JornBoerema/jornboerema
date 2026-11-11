import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ArrowUpRight01Icon,
  CheckmarkSquare02Icon,
  LeftToRightListBulletIcon,
  Mail01Icon,
  SquareIcon,
  TaskAdd01Icon,
  TaskDone01Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@evido/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@evido/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu"
import { Skeleton } from "@evido/ui/components/skeleton"
import { Spinner } from "@evido/ui/components/spinner"
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

/** Compact like the app's other menus; the tick small and quiet on the right. */
const MENU_ITEM =
  "min-h-7 rounded-lg py-1 pr-7 pl-2 text-[13px] [&_[data-slot=dropdown-menu-radio-item-indicator]_svg]:size-3.5 [&_[data-slot=dropdown-menu-radio-item-indicator]]:text-muted-foreground"

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
 * A task in Even doen from this mail, as a small spotlight like the snooze
 * picker: the task as it will look in Even doen (an empty box, its name, the
 * mail it links to), the lists as chips, Tab to pick one, Enter to make it.
 */
export function TodoDialog({
  threadId,
  subject,
  from,
  open,
  onOpenChange,
}: {
  threadId: string
  subject: string
  from: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useI18n().t.todos
  const lists = useTodoLists(open)
  const create = useCreateTodo(threadId)
  const [title, setTitle] = useState(subject)
  const [listId, setListId] = useState("")
  const field = useRef<HTMLTextAreaElement>(null)
  const available = useMemo(() => lists.data?.lists ?? [], [lists.data])
  const groups = groupByWorkspace(available)
  const picked = available.find((list) => list.id === listId)

  useEffect(() => {
    if (open) setTitle(subject)
  }, [open, subject])
  // The last list used, while it still exists; otherwise the first.
  useEffect(() => {
    if (!available.length || available.some((list) => list.id === listId)) return
    const last = lastTodoList()
    setListId(available.find((list) => list.id === last)?.id ?? available[0].id)
  }, [available, listId])
  // The name grows with what it says, up to a few lines.
  useEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${element.scrollHeight}px`
  }, [title, open])

  const step = (by: number) => {
    if (!available.length) return
    const index = available.findIndex((list) => list.id === listId)
    setListId(available[(index + by + available.length) % available.length].id)
  }
  const ready = !!title.trim() && !!listId && !create.isPending
  const submit = () => {
    if (!ready) return
    rememberTodoList(listId)
    create.mutate(
      { listId, title: title.trim() },
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
        showCloseButton={false}
        className="list-spotlight todo-capture"
        style={{ translate: "-50% 0" }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          field.current?.focus()
          field.current?.select()
        }}
      >
        <DialogTitle className="flex items-center gap-2 px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">
          <HugeiconsIcon icon={TaskAdd01Icon} strokeWidth={1.75} aria-hidden="true" className="size-3.5" />
          {t.title}
        </DialogTitle>
        <DialogDescription className="sr-only">{t.description}</DialogDescription>

        <div className="todo-capture-task">
          <span className="todo-capture-box" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <textarea
              ref={field}
              rows={1}
              value={title}
              maxLength={500}
              aria-label={t.task}
              spellCheck={false}
              data-1p-ignore
              onChange={(event) => setTitle(event.target.value.replace(/\n/g, " "))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  submit()
                } else if (event.key === "Tab") {
                  event.preventDefault()
                  step(event.shiftKey ? -1 : 1)
                }
              }}
            />
            {/* The link it keeps: where the task will open from. */}
            <span className="todo-capture-mail">
              <HugeiconsIcon icon={Mail01Icon} strokeWidth={1.75} aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{from ? t.linkedTo(from) : subject}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-1 pt-3 pb-1">
          {lists.isPending && <Skeleton className="h-8 w-40 rounded-lg" />}
          {lists.isSuccess && available.length === 0 && <p className="text-sm text-muted-foreground">{t.noLists}</p>}
          {picked && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="min-w-0 max-w-[60%] text-muted-foreground" aria-label={`${t.list}: ${picked.name}`}>
                  <HugeiconsIcon icon={LeftToRightListBulletIcon} strokeWidth={1.75} data-icon="inline-start" aria-hidden="true" />
                  <span className="truncate font-medium text-foreground">{picked.name}</span>
                  {groups.length > 1 && <span className="truncate font-normal">· {picked.workspaceName}</span>}
                  <HugeiconsIcon icon={UnfoldMoreIcon} strokeWidth={1.75} data-icon="inline-end" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                sideOffset={6}
                className="max-h-72 w-60 rounded-xl p-1"
                onCloseAutoFocus={(event) => {
                  event.preventDefault()
                  field.current?.focus()
                }}
              >
                <DropdownMenuRadioGroup value={listId} onValueChange={setListId}>
                  {groups.map((group, index) => (
                    <div key={group.name}>
                      {index > 0 && <DropdownMenuSeparator className="mx-1 my-1" />}
                      {groups.length > 1 && (
                        <DropdownMenuLabel className="px-2 pt-1.5 pb-1 text-xs font-normal text-muted-foreground">
                          {group.name}
                        </DropdownMenuLabel>
                      )}
                      {group.lists.map((list) => (
                        <DropdownMenuRadioItem key={list.id} value={list.id} className={MENU_ITEM}>
                          <span className="truncate">{list.name}</span>
                        </DropdownMenuRadioItem>
                      ))}
                    </div>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button className="ml-auto" disabled={!ready} onClick={submit}>
            {create.isPending ? <Spinner /> : t.create}
          </Button>
        </div>
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
