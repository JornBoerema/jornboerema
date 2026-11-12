import { apiFetch } from "@/lib/api";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@evido/ui/components/dialog";
import { Button } from "@evido/ui/components/button";
import { Input } from "@evido/ui/components/input";
import { Field, FieldGroup, FieldLabel } from "@evido/ui/components/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@evido/ui/components/select";
import { Alert, AlertDescription } from "@evido/ui/components/alert";
import { Skeleton } from "@evido/ui/components/skeleton";
import type { SharingCommand, SharingData } from "@evido/todo-core/sharing";
import type { TodoList } from "@evido/todo-core/workspace";
import { useI18n } from "@/i18n";

/** Public link to one list. Workspace members already see every list. */
export function ShareListDialog({
  list,
  workspaceName,
  onClose,
}: {
  list: TodoList;
  workspaceName: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const { t: { workspace: { share: t } } } = useI18n();
  const [linkRole, setLinkRole] = useState<"viewer" | "editor">("viewer");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery<SharingData>({
    queryKey: ["sharing", list.id],
    queryFn: async () => {
      const r = await apiFetch(`/api/sharing?listId=${list.id}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      return data;
    },
  });
  async function run(command: SharingCommand) {
    setPending(true);
    setError("");
    try {
      const r = await apiFetch("/api/sharing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      await client.invalidateQueries({ queryKey: ["sharing", list.id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : t.tryAgain);
    } finally {
      setPending(false);
    }
  }
  const link = query.data?.link;
  const linkUrl = link ? `${window.location.origin}/shared/${link.token}` : "";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{list.kind === "note" ? t.shareNote : t.shareList}</DialogTitle>
          <DialogDescription>
            {t.description(workspaceName, list.name)}
          </DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          query.data && (
            <div className="flex flex-col gap-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="link-role">{t.linkAccess}</FieldLabel>
                  <Select
                    value={link?.role ?? linkRole}
                    disabled={pending}
                    onValueChange={(selected) => {
                      const value = selected as typeof linkRole;
                      setLinkRole(value);
                      if (link) void run({ type: "enable-link", listId: list.id, role: value });
                    }}
                  >
                    <SelectTrigger id="link-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="viewer">{t.canView}</SelectItem>
                        <SelectItem value="editor">{t.canEdit}</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                {link && (
                  <Field>
                    <FieldLabel htmlFor="share-link">{t.linkLabel}</FieldLabel>
                    <Input
                      id="share-link"
                      readOnly
                      value={linkUrl}
                      onFocus={(event) => event.target.select()}
                    />
                  </Field>
                )}
              </FieldGroup>
              {link ? (
                <>
                  <Button
                    disabled={pending}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(linkUrl);
                        toast.success(t.copied);
                      } catch {
                        setError(t.copyFailed);
                      }
                    }}
                  >
                    {t.copy}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => void run({ type: "revoke-link", listId: list.id })}
                  >
                    {t.revoke}
                  </Button>
                </>
              ) : (
                <Button
                  disabled={pending}
                  onClick={() => void run({ type: "enable-link", listId: list.id, role: linkRole })}
                >
                  {pending ? t.wait : t.create}
                </Button>
              )}
            </div>
          )
        )}
        {(error || query.error) && (
          <Alert variant="destructive">
            <AlertDescription>{error || query.error?.message}</AlertDescription>
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}
