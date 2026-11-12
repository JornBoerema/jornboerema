import { ComputerIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useInDesktop } from "@evido/ui/components/app-switcher"
import { DropdownMenuItem } from "@evido/ui/components/dropdown-menu"

export const DESKTOP_DOWNLOAD_URL = "https://jornboerema.nl/download"

/**
 * "Download Even for desktop" in an app's account menu on the web; inside the
 * desktop app, which is already that, it shows nothing.
 */
export function DesktopDownloadItem({ label }: { label: string }) {
  if (useInDesktop()) return null
  return (
    <DropdownMenuItem asChild>
      <a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noopener">
        <HugeiconsIcon icon={ComputerIcon} strokeWidth={2} aria-hidden="true" />
        {label}
      </a>
    </DropdownMenuItem>
  )
}
