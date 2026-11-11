import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { MailTodoList, MailTodoView } from "@evido/mail-core/types"
import { api } from "@/lib/api"
import { conversationUrl } from "@/lib/mail"

export const TODO_LISTS_KEY = ["mail-todo-lists"]
const todosKey = (threadId: string) => ["mail-todos", threadId]

/** The lists a task can go to, across the user's Even doen workspaces. */
export function useTodoLists(enabled: boolean) {
  return useQuery({
    queryKey: TODO_LISTS_KEY,
    queryFn: () => api<{ lists: MailTodoList[] }>("/api/mail/todo-lists"),
    enabled,
    staleTime: 60_000,
  })
}

/** The tasks made from a conversation, for above it. */
export function useConversationTodos(threadId: string, enabled: boolean) {
  return useQuery({
    queryKey: todosKey(threadId),
    queryFn: () => api<{ todos: MailTodoView[] }>(conversationUrl(threadId, "/todos")),
    enabled,
    staleTime: 30_000,
    retry: false,
  })
}

export function useCreateTodo(threadId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { listId: string; title: string }) =>
      api<{ todo: MailTodoView }>(conversationUrl(threadId, "/todo"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: ({ todo }) =>
      queryClient.setQueryData<{ todos: MailTodoView[] }>(todosKey(threadId), (current) => ({
        todos: [...(current?.todos ?? []), todo],
      })),
  })
}

const LAST_LIST_KEY = "evido.mail.todo-list"

/** The list picked last time, so the next task goes there without asking. */
export function lastTodoList() {
  try {
    return localStorage.getItem(LAST_LIST_KEY)
  } catch {
    return null
  }
}

export function rememberTodoList(id: string) {
  try {
    localStorage.setItem(LAST_LIST_KEY, id)
  } catch {
    // Without storage the first list is picked next time.
  }
}
