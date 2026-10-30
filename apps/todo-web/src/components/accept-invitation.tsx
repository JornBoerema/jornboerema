import { apiFetch } from "@/lib/api";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@evido/ui/components/button";
import { Alert, AlertDescription } from "@evido/ui/components/alert";
import { authClient } from "@/lib/auth-client";
import { useI18n } from "@/i18n";
export function AcceptInvitation({
  token,
  wrongAccount = false,
}: {
  token: string;
  wrongAccount?: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function act() {
    setPending(true);
    setError("");
    try {
      if (wrongAccount) {
        await authClient.signOut();
        await queryClient.resetQueries();
        setPending(false);
        return;
      }
      const response = await apiFetch(`/api/invitations/${token}`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      queryClient.clear();
      navigate(`/?workspace=${encodeURIComponent(body.workspaceId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.tryAgain);
      setPending(false);
    }
  }
  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button disabled={pending} onClick={act}>
        {wrongAccount
          ? t.auth.invitation.switchAccount
          : pending
            ? t.common.pleaseWait
            : t.auth.invitation.accept}
      </Button>
    </div>
  );
}
