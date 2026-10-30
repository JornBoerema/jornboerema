export type Tool = "select" | "arrow" | "rect" | "ellipse" | "line" | "pen" | "highlight" | "text" | "step" | "blur"

type Base = { id: string; color: string; size: StrokeSize }

/** All coordinates are in image pixels, so drawings stay sharp at full resolution. */
export type Shape =
  | (Base & { kind: "arrow" | "line" | "pen" | "highlight"; points: number[] })
  | (Base & { kind: "rect" | "ellipse" | "blur"; x: number; y: number; w: number; h: number })
  | (Base & { kind: "text"; x: number; y: number; text: string })
  | (Base & { kind: "step"; x: number; y: number; n: number })

export type StrokeSize = "s" | "m" | "l"

export const COLORS = ["#ef4444", "#f07a2b", "#facc15", "#22c55e", "#3b82f6", "#111111", "#ffffff"] as const

/** Stroke width in image pixels; scales with the screenshot so it looks the same everywhere. */
export function strokeWidth(size: StrokeSize, imageWidth: number, imageHeight: number) {
  const base = Math.max(1, Math.max(imageWidth, imageHeight) / 1000)
  return { s: 2, m: 3.5, l: 6 }[size] * base
}

/** Keyboard shortcut per tool. */
export const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  a: "arrow",
  r: "rect",
  o: "ellipse",
  l: "line",
  p: "pen",
  h: "highlight",
  t: "text",
  n: "step",
  b: "blur",
}

export const newId = () => crypto.randomUUID()
