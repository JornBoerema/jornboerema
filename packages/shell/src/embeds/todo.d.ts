// The app is type-checked in apps/todo-web, where its "@/" imports resolve.
// The shell only needs what it mounts.
import type { EvidoAuthClient } from "@evido/auth/client"

export declare function TodoEmbed(): React.JSX.Element
export declare function TodoSettingsNav(): React.JSX.Element
/** A shared list and an invitation, on their own under `base`. */
export declare function TodoPublic(props: { base: string }): React.JSX.Element
export declare const authClient: EvidoAuthClient
