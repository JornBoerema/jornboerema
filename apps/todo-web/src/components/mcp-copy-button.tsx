import { useState } from "react";
import { Button } from "@evido/ui/components/button";
import { useI18n } from "@/i18n";

export function McpCopyButton({ url }: { url: string }) {
  const { t } = useI18n();
  const s = t.docs.connection;
  const [message, setMessage] = useState("");
  return <div className="mcp-copy">
    <Button variant="outline" onClick={async () => {
      try {
        await navigator.clipboard.writeText(url);
        setMessage(s.copied);
      } catch {
        setMessage(s.copyFailed);
      }
    }}>{s.copy}</Button>
    <p role="status" className="mcp-copy-status">{message}</p>
  </div>;
}
