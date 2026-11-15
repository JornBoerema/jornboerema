// The app is type-checked in apps/todo-web, where its "@/" imports resolve.
// The shell only needs what it mounts.
import type { EvidoAuthClient } from "@evido/auth/client"

export declare function TodoEmbed(): React.JSX.Element
/** The organizations around every app; the picker must sit inside it. */
export declare function TodoOrganizations(props: { children: React.ReactNode }): React.JSX.Element
/** The active organization in the rail, with the menu to switch. */
export declare function OrganizationPicker(): React.JSX.Element
/** The dashboard: a look across the apps, at the head of the rail. */
export declare function DashboardEmbed(): React.JSX.Element
export declare function TodoSettingsNav(): React.JSX.Element
/** A shared list and an invitation, on their own under `base`. */
export declare function TodoPublic(props: { base: string }): React.JSX.Element
export declare const authClient: EvidoAuthClient
