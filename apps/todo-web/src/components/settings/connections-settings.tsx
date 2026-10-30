import { useState } from "react"
import { Link } from "react-router"
import { API_URL } from "@/lib/api"
import { ExternalLink } from "@/components/icons"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import { Button } from "@evido/ui/components/button"

export function ConnectionsSettings() {
  const mcpUrl = `${API_URL}/mcp`
  const [copied, setCopied] = useState(false)
  return (
    <SettingsSection
      title="AI-assistenten"
      description="Laat ChatGPT of een andere MCP-client je lijsten lezen en bijwerken."
    >
      <SettingsRow
        title="MCP-URL"
        description={<code className="text-xs break-all text-foreground">{mcpUrl}</code>}
      >
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(mcpUrl)
              setCopied(true)
            } catch {
              setCopied(false)
            }
          }}
        >
          {copied ? "Gekopieerd" : "Kopiëren"}
        </Button>
      </SettingsRow>
      <SettingsRow
        title="Uitleg en voorbeelden"
        description="Stap voor stap koppelen, plus alle beschikbare acties."
      >
        <Button asChild variant="outline">
          <Link to="/docs">
            Bekijk uitleg
            <ExternalLink data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
      </SettingsRow>
    </SettingsSection>
  )
}
