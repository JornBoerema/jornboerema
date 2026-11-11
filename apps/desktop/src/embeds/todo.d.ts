// The app is type-checked in apps/todo-web, where its "@/" imports resolve.
// The desktop app only needs what it mounts.
import type { ReactNode } from "react"
import type { EvidoAuthClient } from "@evido/auth/client"

export declare function TodoEmbed(): React.JSX.Element
export declare function TodoSignIn(props: { brand: ReactNode }): React.JSX.Element
export declare const authClient: EvidoAuthClient
