
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, Reorder, useDragControls, useReducedMotion } from "motion/react";

export type Move = { id: string; targetId: string; placement: "before" | "after" };
type Item = { id: string };
type Props<T extends Item> = {
  items: T[];
  disabled: boolean;
  onMove: (move: Move) => Promise<boolean>;
  /** Accessible name of each draggable row. */
  label: (item: T) => string;
  children: (item: T) => ReactNode;
  className?: string;
  itemClassName?: string;
  /**
   * "row": the row itself is focusable and ↑/↓ move it (task rows).
   * "content": the row contains its own button; ⌥↑/⌥↓ on it move the row
   * (sidebar links), and dragging may start on that button.
   */
  keyboard?: "row" | "content";
};

/** Drag-to-reorder for a vertical list (mouse, long-press on touch, keyboard). */
export function Sortable<T extends Item>({ items, disabled, onMove, label, children, className, itemClassName = "bg-background", keyboard = "row" }: Props<T>) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const order = useRef<string[] | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const visible = draft
    ? [...draft.map((id) => items.find((t) => t.id === id)).filter((t): t is T => !!t), ...items.filter((t) => !draft.includes(t.id))]
    : items;
  async function move(command: Move) {
    const ok = await onMove(command);
    setAnnouncement(ok ? "Volgorde opgeslagen." : "Verplaatsen is niet gelukt.");
    order.current = null;
    setDraft(null);
  }
  function finish(id: string) {
    const ids = order.current;
    if (!ids || disabled) { order.current = null; setDraft(null); return; }
    const index = ids.indexOf(id);
    const targetId = ids[index + 1] ?? ids[index - 1];
    if (index < 0 || !targetId || ids.join() === items.map((t) => t.id).join()) {
      order.current = null; setDraft(null); return;
    }
    void move({ id, targetId, placement: ids[index + 1] ? "before" : "after" });
  }
  return (
    <>
      <p className="sr-only" role="status">{announcement}</p>
      <Reorder.Group as="div" axis="y" className={className} values={visible.map((t) => t.id)} onReorder={(ids) => { order.current = ids; setDraft(ids); }}>
        <AnimatePresence initial={false}>
          {visible.map((item, index) => (
            <SortableItem key={item.id} id={item.id} label={label(item)} className={itemClassName} keyboard={keyboard} disabled={disabled || items.length < 2}
              onFinish={() => finish(item.id)}
              onCancel={() => { order.current = null; setDraft(null); }}
              onStep={(direction) => {
                const target = visible[index + direction];
                if (target) void move({ id: item.id, targetId: target.id, placement: direction < 0 ? "before" : "after" });
              }}>
              {children(item)}
            </SortableItem>
          ))}
        </AnimatePresence>
      </Reorder.Group>
    </>
  );
}
function SortableItem({ id, label, className, keyboard, disabled, onFinish, onCancel, onStep, children }: {
  id: string; label: string; className: string; keyboard: "row" | "content"; disabled: boolean;
  onFinish: () => void; onCancel: () => void; onStep: (direction: -1 | 1) => void; children: ReactNode;
}) {
  const interactive = keyboard === "row"
    ? "button, input, [contenteditable], [role=checkbox], a"
    : "input, [contenteditable]";
  const controls = useDragControls();
  const reduced = useReducedMotion();
  const element = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const touchDragging = useRef(false);
  function clearTouch() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    touchStart.current = null;
    touchDragging.current = false;
  }
  useEffect(() => {
    const node = element.current;
    const move = (event: TouchEvent) => {
      if (touchDragging.current) { event.preventDefault(); return; }
      const start = touchStart.current;
      const touch = event.touches[0];
      if (start && touch && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 8) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        touchStart.current = null;
      }
    };
    node?.addEventListener("touchmove", move, { passive: false });
    return () => { node?.removeEventListener("touchmove", move); if (timer.current) clearTimeout(timer.current); };
  }, []);
  return (
    <Reorder.Item ref={element} as="div" role="listitem" value={id}
      className={`relative select-none ${className}`} style={{ cursor: disabled ? undefined : "grab", touchAction: "pan-y" }}
      tabIndex={disabled || keyboard === "content" ? undefined : 0} aria-label={keyboard === "row" ? label : undefined}
      aria-description={disabled ? undefined : keyboard === "row"
        ? "Sleep om te verplaatsen. Op je telefoon: houd even ingedrukt. Of gebruik de pijltjestoetsen."
        : "Sleep om te verplaatsen, of gebruik Option of Alt met de pijltjestoetsen."}
      dragListener={false} dragControls={controls}
      onDragStart={() => { dragged.current = true; }}
      onDragEnd={() => { clearTouch(); onFinish(); }}
      onPointerDown={(event) => {
        dragged.current = false;
        if (disabled || event.button !== 0 || (event.target as HTMLElement).closest(interactive)) return;
        if (event.pointerType === "touch") {
          touchStart.current = { x: event.clientX, y: event.clientY };
          timer.current = setTimeout(() => { touchDragging.current = true; controls.start(event); }, 250);
        } else controls.start(event);
      }}
      onPointerUp={clearTouch}
      onPointerCancel={() => { clearTouch(); controls.cancel(); onCancel(); }}
      onClickCapture={(event) => { if (dragged.current) { event.preventDefault(); event.stopPropagation(); dragged.current = false; } }}
      onContextMenu={(event) => { if (touchStart.current || touchDragging.current) event.preventDefault(); }}
      onKeyDown={(event) => {
        if (disabled) return;
        if (keyboard === "row" && event.target !== event.currentTarget) return;
        if (keyboard === "content" && !event.altKey) return;
        if (event.key === "Escape") { clearTouch(); controls.cancel(); onCancel(); }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          onStep(event.key === "ArrowUp" ? -1 : 1);
          // Keep focus on the moved link after the re-render.
          if (keyboard === "content") requestAnimationFrame(() => (event.target as HTMLElement).focus());
        }
      }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.18 }}>
      {children}
    </Reorder.Item>
  );
}
