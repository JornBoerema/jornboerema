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
  NativeSelect,
  NativeSelectOption,
} from "@evido/ui/components/native-select";
import { Alert, AlertDescription } from "@evido/ui/components/alert";
import { Skeleton } from "@evido/ui/components/skeleton";
import type { SharingCommand, SharingData } from "@evido/todo-core/sharing";
import type { TodoList } from "@evido/todo-core/workspace";

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
      setError(e instanceof Error ? e.message : "Probeer opnieuw.");
    } finally {
      setPending(false);
    }
  }
  const link = query.data?.link;
  const linkUrl = link ? `${window.location.origin}/gedeeld/${link.token}` : "";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{list.kind === "note" ? "Notitie delen" : "Lijst delen"}</DialogTitle>
          <DialogDescription>
            Iedereen in {workspaceName} ziet ‘{list.name}’ al. Met een link deel je hem ook met
            iemand zonder account.
          </DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          query.data && (
            <div className="flex flex-col gap-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="link-role">Toegang via link</FieldLabel>
                  <NativeSelect
                    id="link-role"
                    value={link?.role ?? linkRole}
                    disabled={pending}
                    onChange={(event) => {
                      const value = event.target.value as typeof linkRole;
                      setLinkRole(value);
                      if (link) void run({ type: "enable-link", listId: list.id, role: value });
                    }}
                  >
                    <NativeSelectOption value="viewer">Kan bekijken</NativeSelectOption>
                    <NativeSelectOption value="editor">Kan bewerken</NativeSelectOption>
                  </NativeSelect>
                </Field>
                {link && (
                  <Field>
                    <FieldLabel htmlFor="share-link">Link naar de lijst</FieldLabel>
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
                        toast.success("Link gekopieerd.");
                      } catch {
                        setError("Kopiëren lukt niet. Selecteer en kopieer de link hierboven.");
                      }
                    }}
                  >
                    Link kopiëren
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => void run({ type: "revoke-link", listId: list.id })}
                  >
                    Link intrekken
                  </Button>
                </>
              ) : (
                <Button
                  disabled={pending}
                  onClick={() => void run({ type: "enable-link", listId: list.id, role: linkRole })}
                >
                  {pending ? "Even geduld…" : "Link maken"}
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
