import { useCallback, useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { useDesktopSettings } from "@evido/ui/components/desktop-settings"
import {
  OrganizationsProvider,
  useOrganizations,
  type OrganizationSummary,
} from "@evido/ui/components/organizations"
import { Button } from "@evido/ui/components/button"
import { Input } from "@evido/ui/components/input"
import { Field, FieldGroup, FieldLabel } from "@evido/ui/components/field"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@evido/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@evido/ui/components/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@evido/ui/components/tooltip"
import { authClient } from "@/lib/auth-client"
import { useWorkspaceCommand, useWorkspaces } from "@/lib/workspaces"
import { useI18n } from "@/i18n"
import { Check, Plus, Settings } from "@/components/icons"

/** Before organizations, the workspace was remembered per browser; that choice carries over once. */
const OLD_STORAGE_KEY = "evido.todo.workspace"

function rememberedBefore() {
  try {
    return localStorage.getItem(OLD_STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * The organizations for the Even shell: which there are, and which one the apps show.
 * The choice is kept on the session (Better Auth's active organization), so every
 * device follows; until the user picks one it is their personal organization.
 */
export function ShellOrganizations({ children }: { children: ReactNode }) {
  const session = authClient.useSession()
  const user = session.data?.user
  const organizations = useWorkspaces(user?.id ?? "")
  const [picked, setPicked] = useState<string | null>(null)
  const stored = (
    session.data?.session as
      { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId

  const list = organizations.data
  const refetch = organizations.refetch
  const select = useCallback((id: string) => {
    setPicked(id)
    void authClient.organization.setActive({ organizationId: id }).catch(() => {
      // Kept for this window at least; the next pick tries again.
    })
  }, [])
  const refresh = useCallback(async () => {
    await refetch()
  }, [refetch])

  const value = useMemo(() => {
    if (!list?.length) return null
    const find = (id: string | null | undefined) =>
      id ? list.find((item) => item.id === id) : undefined
    const active =
      find(picked) ??
      find(stored) ??
      find(rememberedBefore()) ??
      list.find((item) => item.personal) ??
      list[0]
    return {
      organizations: list as OrganizationSummary[],
      active: active as OrganizationSummary,
      select,
      refresh,
    }
  }, [list, picked, stored, select, refresh])

  return <OrganizationsProvider value={value}>{children}</OrganizationsProvider>
}

/** The organization's initial, in a tile; the personal one shows the person's. */
function OrganizationMark({
  name,
  small = false,
}: {
  name: string
  small?: boolean
}) {
  return (
    <span
      className={small ? "organization-mark is-small" : "organization-mark"}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  )
}

/**
 * In the rail, under the Even mark: the active organization, and a menu to switch,
 * make a new one or open its settings.
 */
export function OrganizationPicker() {
  const organizations = useOrganizations()
  const settings = useDesktopSettings("todo")
  const session = authClient.useSession()
  const {
    t: {
      workspace: { switcher: t },
    },
  } = useI18n()
  const command = useWorkspaceCommand(session.data?.user.id ?? "")
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  if (!organizations)
    return <span className="organization-mark is-loading" aria-hidden="true" />
  const { active, select, refresh } = organizations
  const label = (organization: OrganizationSummary) =>
    organization.personal ? t.personal : organization.name

  async function create(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || pending) return
    setPending(true)
    const id = crypto.randomUUID()
    try {
      await command({ type: "create", id, name: name.trim() })
      await refresh()
      select(id)
      setCreating(false)
      setName("")
      toast.success(t.created(name.trim()))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.failed)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="app-rail-button organization-button"
                aria-label={t.triggerLabel(label(active))}
              >
                <OrganizationMark name={label(active)} />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            {label(active)}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          side="right"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          className="min-w-64"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t.organizations}</DropdownMenuLabel>
            {organizations.organizations.map((organization) => (
              <DropdownMenuItem
                key={organization.id}
                onSelect={() => select(organization.id)}
              >
                <OrganizationMark name={label(organization)} small />
                <span className="min-w-0 flex-1 truncate">
                  {label(organization)}
                </span>
                {organization.memberCount > 1 && (
                  <span className="text-xs text-muted-foreground">
                    {t.members(organization.memberCount)}
                  </span>
                )}
                {organization.id === active.id && (
                  <Check aria-label={t.active} />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              {t.newOrganization}
            </DropdownMenuItem>
            {settings && (
              <DropdownMenuItem
                onSelect={() =>
                  settings.open(active.personal ? "workspace" : "members")
                }
              >
                <Settings aria-hidden="true" />
                {t.settings}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={creating}
        onOpenChange={(open) => !pending && setCreating(open)}
      >
        <DialogContent>
          <form onSubmit={create} className="flex flex-col gap-6">
            <DialogHeader>
              <DialogTitle>{t.newOrganization}</DialogTitle>
              <DialogDescription>{t.dialogDescription}</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="organization-name">{t.name}</FieldLabel>
                <Input
                  id="organization-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t.namePlaceholder}
                  maxLength={60}
                  required
                  autoFocus
                  disabled={pending}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setCreating(false)}
              >
                {t.cancel}
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? t.creating : t.create}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
