
import { useState } from "react";
import { Button } from "@evido/ui/components/button";

export function McpCopyButton({ url }: { url: string }) {
  const [message, setMessage] = useState("");
  return <div className="mcp-copy">
    <Button variant="outline" onClick={async () => {
      try {
        await navigator.clipboard.writeText(url);
        setMessage("MCP-URL gekopieerd.");
      } catch {
        setMessage("Kopiëren lukt niet. Selecteer de URL hierboven en kopieer deze handmatig.");
      }
    }}>Kopieer MCP-URL</Button>
    <p role="status" className="mcp-copy-status">{message}</p>
  </div>;
}
