import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react"
import Konva from "konva"
import { Arrow, Circle, Ellipse, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva"
import { newId, strokeWidth, type Shape, type StrokeSize, type Tool } from "./types"

export type CanvasHandle = {
  /** The screenshot with all drawings, as PNG bytes at full resolution. */
  exportPng: () => Promise<Uint8Array>
}

type Props = {
  image: HTMLImageElement
  tool: Tool
  color: string
  size: StrokeSize
  shapes: Shape[]
  onCommit: (shapes: Shape[]) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
}

type Draft = Shape & { originX?: number; originY?: number }

const MIN_DRAG = 3
const FONT = "Inter Variable, Inter, system-ui, sans-serif"
/** Resizable shapes get handles; the rest can only be moved. */
const RESIZABLE = new Set<Shape["kind"]>(["rect", "ellipse", "blur"])

export const AnnotationCanvas = forwardRef<CanvasHandle, Props>(function AnnotationCanvas(
  { image, tool, color, size, shapes, onCommit, selectedId, onSelect },
  ref
) {
  const container = useRef<HTMLDivElement>(null)
  const stage = useRef<Konva.Stage>(null)
  const layer = useRef<Konva.Layer>(null)
  const transformer = useRef<Konva.Transformer>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)

  const iw = image.naturalWidth
  const ih = image.naturalHeight
  // Fit the image into the available area; drawings live in image pixels.
  const scale = box.width && box.height ? Math.min(box.width / iw, box.height / ih) : 1
  const ox = (box.width - iw * scale) / 2
  const oy = (box.height - ih * scale) / 2
  const stroke = (s: StrokeSize) => strokeWidth(s, iw, ih)

  useLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height })
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Attach resize handles to the selected shape.
  useEffect(() => {
    const tr = transformer.current
    if (!tr) return
    const shape = shapes.find((s) => s.id === selectedId)
    const node = shape && RESIZABLE.has(shape.kind) ? layer.current?.findOne(`#${selectedId}`) : undefined
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [selectedId, shapes])

  useImperativeHandle(ref, () => ({
    exportPng: async () => {
      transformer.current?.nodes([])
      const blob = (await stage.current!.toBlob({
        x: ox,
        y: oy,
        width: iw * scale,
        height: ih * scale,
        pixelRatio: 1 / scale,
        mimeType: "image/png",
      })) as Blob
      return new Uint8Array(await blob.arrayBuffer())
    },
  }))

  const pointer = () => layer.current?.getRelativePointerPosition() ?? { x: 0, y: 0 }
  const replace = (next: Shape) => onCommit(shapes.map((s) => (s.id === next.id ? next : s)))

  function onPointerDown(event: Konva.KonvaEventObject<PointerEvent>) {
    if (editing) return
    const { x, y } = pointer()
    if (tool === "select") {
      if (event.target === event.target.getStage() || event.target.name() === "screenshot") onSelect(null)
      return
    }
    const base = { id: newId(), color, size }
    switch (tool) {
      case "arrow":
      case "line":
      case "pen":
      case "highlight":
        setDraft({ ...base, kind: tool, points: tool === "pen" || tool === "highlight" ? [x, y] : [x, y, x, y] })
        break
      case "rect":
      case "ellipse":
      case "blur":
        setDraft({ ...base, kind: tool, x, y, w: 0, h: 0, originX: x, originY: y })
        break
      case "text": {
        // Keep the browser from moving focus to the page, which would close the text field.
        event.evt.preventDefault()
        const shape: Shape = { ...base, kind: "text", x, y, text: "" }
        onCommit([...shapes, shape])
        setEditing({ id: shape.id, text: "" })
        break
      }
      case "step": {
        const n = Math.max(0, ...shapes.map((s) => (s.kind === "step" ? s.n : 0))) + 1
        onCommit([...shapes, { ...base, kind: "step", x, y, n }])
        break
      }
    }
  }

  function onPointerMove() {
    if (!draft) return
    const { x, y } = pointer()
    if (draft.kind === "pen" || draft.kind === "highlight") setDraft({ ...draft, points: [...draft.points, x, y] })
    else if (draft.kind === "arrow" || draft.kind === "line") setDraft({ ...draft, points: [draft.points[0], draft.points[1], x, y] })
    else if (draft.kind === "rect" || draft.kind === "ellipse" || draft.kind === "blur") {
      const x0 = draft.originX!
      const y0 = draft.originY!
      setDraft({ ...draft, x: Math.min(x0, x), y: Math.min(y0, y), w: Math.abs(x - x0), h: Math.abs(y - y0) })
    }
  }

  function onPointerUp() {
    if (!draft) return
    const { originX: _x, originY: _y, ...shape } = draft
    setDraft(null)
    const big =
      "points" in shape
        ? shape.points.length > 4 || Math.hypot(shape.points[2] - shape.points[0], shape.points[3] - shape.points[1]) > MIN_DRAG / scale
        : "w" in shape && shape.w > MIN_DRAG / scale && shape.h > MIN_DRAG / scale
    if (big) onCommit([...shapes, shape])
  }

  /** Moves a shape after dragging; point-based shapes get their points shifted. */
  function onDragEnd(shape: Shape, node: Konva.Node) {
    if ("points" in shape) {
      const dx = node.x()
      const dy = node.y()
      node.position({ x: 0, y: 0 })
      replace({ ...shape, points: shape.points.map((p, i) => p + (i % 2 ? dy : dx)) })
    } else if (shape.kind === "ellipse") {
      replace({ ...shape, x: node.x() - shape.w / 2, y: node.y() - shape.h / 2 })
    } else replace({ ...shape, x: node.x(), y: node.y() })
  }

  function onTransformEnd(shape: Shape, node: Konva.Node) {
    if (!("w" in shape)) return
    const w = Math.max(MIN_DRAG, shape.w * node.scaleX())
    const h = Math.max(MIN_DRAG, shape.h * node.scaleY())
    node.scale({ x: 1, y: 1 })
    const x = shape.kind === "ellipse" ? node.x() - w / 2 : node.x()
    const y = shape.kind === "ellipse" ? node.y() - h / 2 : node.y()
    replace({ ...shape, x, y, w, h })
  }

  function finishText() {
    if (!editing) return
    const text = editing.text.trim()
    const shape = shapes.find((s) => s.id === editing.id)
    setEditing(null)
    if (!shape || shape.kind !== "text") return
    // Empty text removes the placeholder without leaving an undo step behind.
    onCommit(text ? shapes.map((s) => (s.id === shape.id ? { ...shape, text } : s)) : shapes.filter((s) => s.id !== shape.id))
  }

  const selectable = tool === "select"
  const common = (shape: Shape) => ({
    id: shape.id,
    draggable: selectable,
    onPointerDown: () => selectable && onSelect(shape.id),
    onDragStart: () => onSelect(shape.id),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => onDragEnd(shape, e.target),
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => onTransformEnd(shape, e.target),
    onDblClick: () => shape.kind === "text" && setEditing({ id: shape.id, text: shape.text }),
  })

  const editingShape = editing ? shapes.find((s) => s.id === editing.id) : undefined
  const fontSize = (s: StrokeSize) => stroke(s) * 7

  return (
    <div ref={container} className="relative size-full overflow-hidden" style={{ cursor: selectable ? "default" : "crosshair" }}>
      {box.width > 0 && (
        <Stage
          ref={stage}
          width={box.width}
          height={box.height}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <Layer ref={layer} x={ox} y={oy} scaleX={scale} scaleY={scale}>
            <KonvaImage image={image} name="screenshot" width={iw} height={ih} />
            {[...shapes, ...(draft ? [draft] : [])].map((shape) => {
              const w = stroke(shape.size)
              switch (shape.kind) {
                case "arrow":
                  return (
                    <Arrow key={shape.id} {...common(shape)} points={shape.points} stroke={shape.color} fill={shape.color}
                      strokeWidth={w} pointerLength={w * 3.2} pointerWidth={w * 3.2} lineCap="round" lineJoin="round" hitStrokeWidth={w * 4} />
                  )
                case "line":
                  return (
                    <Line key={shape.id} {...common(shape)} points={shape.points} stroke={shape.color} strokeWidth={w}
                      lineCap="round" hitStrokeWidth={w * 4} />
                  )
                case "pen":
                  return (
                    <Line key={shape.id} {...common(shape)} points={shape.points} stroke={shape.color} strokeWidth={w}
                      tension={0.4} lineCap="round" lineJoin="round" hitStrokeWidth={w * 4} />
                  )
                case "highlight":
                  return (
                    <Line key={shape.id} {...common(shape)} points={shape.points} stroke={shape.color} strokeWidth={w * 5}
                      opacity={0.4} lineCap="round" lineJoin="round" />
                  )
                case "rect":
                  return (
                    <Rect key={shape.id} {...common(shape)} x={shape.x} y={shape.y} width={shape.w} height={shape.h}
                      stroke={shape.color} strokeWidth={w} cornerRadius={w} />
                  )
                case "ellipse":
                  return (
                    <Ellipse key={shape.id} {...common(shape)} x={shape.x + shape.w / 2} y={shape.y + shape.h / 2}
                      radiusX={shape.w / 2} radiusY={shape.h / 2} stroke={shape.color} strokeWidth={w} />
                  )
                case "blur":
                  return <Pixelated key={shape.id} {...common(shape)} image={image} shape={shape} />
                case "text":
                  return (
                    <Text key={shape.id} {...common(shape)} x={shape.x} y={shape.y} text={shape.text} fill={shape.color}
                      fontSize={fontSize(shape.size)} fontFamily={FONT} fontStyle="bold"
                      shadowColor={shape.color === "#111111" ? "#ffffff" : "#000000"} shadowBlur={w} shadowOpacity={0.5}
                      visible={editing?.id !== shape.id} />
                  )
                case "step": {
                  const r = fontSize(shape.size) * 0.75
                  return (
                    <Group key={shape.id} {...common(shape)} x={shape.x} y={shape.y}>
                      <Circle radius={r} fill={shape.color} shadowColor="#000" shadowBlur={w} shadowOpacity={0.35} />
                      <Text text={String(shape.n)} width={r * 2} height={r * 2} x={-r} y={-r} align="center" verticalAlign="middle"
                        fontSize={r * 1.1} fontFamily={FONT} fontStyle="bold"
                        fill={shape.color === "#ffffff" || shape.color === "#facc15" ? "#111111" : "#ffffff"} />
                    </Group>
                  )
                }
              }
            })}
            <Transformer ref={transformer} rotateEnabled={false} keepRatio={false} ignoreStroke
              anchorSize={8} anchorCornerRadius={4} borderStroke="#f07a2b" anchorStroke="#f07a2b" />
          </Layer>
        </Stage>
      )}

      {editing && editingShape?.kind === "text" && (
        <textarea
          ref={(element) => {
            if (element && document.activeElement !== element) requestAnimationFrame(() => element.focus())
          }}
          value={editing.text}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          onBlur={finishText}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
              e.preventDefault()
              finishText()
            }
          }}
          rows={Math.max(1, editing.text.split("\n").length)}
          className="absolute resize-none border-0 bg-transparent p-0 font-bold outline-none"
          style={{
            left: ox + editingShape.x * scale,
            top: oy + editingShape.y * scale,
            fontSize: fontSize(editingShape.size) * scale,
            lineHeight: 1,
            fontFamily: FONT,
            color: editingShape.color,
            caretColor: editingShape.color,
            minWidth: 40,
            width: `${Math.max(4, ...editing.text.split("\n").map((l) => l.length + 1))}ch`,
          }}
        />
      )}
    </div>
  )
})

/** A pixelated copy of the screenshot region, drawn on top of it. */
function Pixelated({
  image,
  shape,
  ...props
}: { image: HTMLImageElement; shape: Extract<Shape, { w: number }> } & Record<string, unknown>) {
  const node = useRef<Konva.Image>(null)
  const w = Math.max(1, Math.round(shape.w))
  const h = Math.max(1, Math.round(shape.h))
  // Blocks relative to the region: small enough to read as a mosaic, big enough to hide text.
  const pixel = Math.round(Math.min(32, Math.max(6, Math.min(w, h) / 5)))
  useEffect(() => {
    node.current?.cache()
    node.current?.getLayer()?.batchDraw()
  }, [w, h, shape.x, shape.y, pixel])
  return (
    <KonvaImage
      ref={node}
      {...props}
      image={image}
      x={shape.x}
      y={shape.y}
      width={w}
      height={h}
      crop={{ x: shape.x, y: shape.y, width: w, height: h }}
      filters={[Konva.Filters.Pixelate]}
      pixelSize={pixel}
    />
  )
}
