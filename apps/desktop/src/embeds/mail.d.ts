// The app is type-checked in apps/mail-web, where its "@/" imports resolve.
// The desktop app only needs what it mounts.
export declare function MailEmbed(props: { active: boolean }): React.JSX.Element

/** Mirrors MailStorage in apps/mail-web/src/lib/cache.ts. */
export type MailStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  getThread(userId: string, id: string): Promise<string | null>
  putThread(userId: string, id: string, value: string): Promise<void>
  clear(): Promise<void>
}
export declare function setMailStorage(storage: MailStorage): void
