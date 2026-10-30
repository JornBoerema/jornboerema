export const en = {
  editor: {
    copy: "Copy",
    copied: "Copied to clipboard",
    save: "Save",
    saved: (path: string) => `Saved to ${path}`,
    close: "Close",
    loading: "Loading screenshot…",
    failed: "Something went wrong. Please try again.",
    size: (width: number, height: number) => `${width} × ${height}`,
    fileName: (stamp: string) => `Screenshot ${stamp}.png`,
  },
  permission: {
    title: "Allow screen recording",
    body: "Even vastleggen needs permission to record your screen to take screenshots. Turn it on in System Settings, then try again.",
    open: "Open System Settings",
    later: "Not now",
  },
}
