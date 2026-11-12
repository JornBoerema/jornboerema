import { useState } from "react"
import { API_URL } from "@/lib/api"
import { useI18n } from "@/i18n"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import { Button } from "@evido/ui/components/button"

/** `title` names the part in the desktop app, where every app's connections share a page. */
export function ConnectionsSettings({ title }: { title?: string }) {
  const { t } = useI18n()
  const s = t.settings.connections
  const mcpUrl = `${API_URL}/mcp`
  const [copied, setCopied] = useState(false)
  return (
    <SettingsSection title={title ?? s.title} description={s.description}>
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
        title={s.howTo}
        description={
          <div className="flex flex-col gap-3">
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              <li>{s.steps.one}</li>
              <li>{s.steps.two}</li>
              <li>{s.steps.three}</li>
            </ol>
            <p>{s.example}</p>
          </div>
        }
      />
    </SettingsSection>
  )
}
