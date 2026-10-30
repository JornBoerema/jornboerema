import { useState } from "react"
import { Link } from "react-router"
import { API_URL } from "@/lib/api"
import { useI18n } from "@/i18n"
import { ExternalLink } from "@/components/icons"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import { Button } from "@evido/ui/components/button"

export function ConnectionsSettings() {
  const { t } = useI18n()
  const s = t.settings.connections
  const mcpUrl = `${API_URL}/mcp`
  const [copied, setCopied] = useState(false)
  return (
    <SettingsSection
      title={s.title}
      description={s.description}
    >
      <SettingsRow
        title={s.mcpUrl}
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
          {copied ? s.copied : s.copy}
        </Button>
      </SettingsRow>
      <SettingsRow
        title={s.guide}
        description={s.guideHelp}
      >
        <Button asChild variant="outline">
          <Link to="/docs">
            {s.viewGuide}
            <ExternalLink data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
      </SettingsRow>
    </SettingsSection>
  )
}
