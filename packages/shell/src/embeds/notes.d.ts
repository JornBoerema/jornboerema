// The app is type-checked in apps/notes-web, where its "@/" imports resolve.
// The shell only needs what it mounts.
export declare function NotesEmbed(): React.JSX.Element
/** A shared note and an invitation, on their own under `base`. */
export declare function NotesPublic(props: { base: string }): React.JSX.Element
