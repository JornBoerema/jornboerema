import { apiFetch } from "@/lib/api";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@evido/ui/components/button";
import { Alert, AlertDescription } from "@evido/ui/components/alert";
import type { TodoList } from "@evido/todo-core/workspace";
import { useI18n } from "@/i18n";

const blockIds = ["paragraph", "h1", "h2", "h3", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "horizontalRule"] as const;
function formatBlock(editor: Editor, id: string) {
  const chain = editor.chain().focus().clearNodes();
  if (id === "h1" || id === "h2" || id === "h3") chain.setHeading({ level: Number(id[1]) as 1 | 2 | 3 }).run();
  else if (id === "bulletList") chain.toggleBulletList().run();
  else if (id === "orderedList") chain.toggleOrderedList().run();
  else if (id === "taskList") chain.toggleTaskList().run();
  else if (id === "blockquote") chain.setBlockquote().run();
  else if (id === "codeBlock") chain.setCodeBlock().run();
  else if (id === "horizontalRule") chain.setHorizontalRule().run();
  else chain.setParagraph().run();
}
type Slash = { from: number; to: number; query: string; index: number; top: number };
function getSlash(editor: Editor): Slash | null {
  const { $from, empty } = editor.state.selection;
  const match = empty && $from.parent.type.name === "paragraph" && /^\/([^\n]*)$/.exec($from.parent.textContent);
  if (!match) return null;
  const parent = editor.view.dom.closest(".note-editor");
  const top = editor.view.coordsAtPos(editor.state.selection.from).bottom - (parent?.getBoundingClientRect().top ?? 0) + 4;
  return { from: $from.start(), to: $from.end(), query: match[1], index: 0, top };
}
export default function NoteEditor({ list, identity, endpoint, saveRef, downloadRef }: {
  list: TodoList; identity: string; endpoint: string; saveRef: RefObject<(() => Promise<boolean>) | null>; downloadRef: RefObject<(() => void) | null>;
}) {
  const client = useQueryClient();
  const { t: { workspace: { note: t } } } = useI18n();
  const blocks = blockIds.map((id) => ({ id, label: t.blocks[id] }));
  // The editor and its callbacks are created once; read texts through a ref.
  const texts = useRef(t);
  useEffect(() => {
    texts.current = t;
  }, [t]);
  const canEdit = list.role !== "viewer";
  const storageKey = `even-doen:note-draft:${identity}:${list.id}`;
  const draft = useRef({ markdown: list.note?.markdown ?? "", saved: list.note?.markdown ?? "", version: list.note?.version ?? 0 });
  const inFlight = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const blocked = useRef(false);
  const [slash, setSlash] = useState<Slash | null>(null);
  const slashRef = useRef<Slash | null>(null);
  const slashKey = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const changed = useRef<(editor: Editor) => void>(() => {});
  const persist = useCallback(() => {
    try {
      if (draft.current.markdown === draft.current.saved) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify({ markdown: draft.current.markdown, version: draft.current.version }));
    } catch { /* Saving to the server still works if browser storage is unavailable. */ }
  }, [storageKey]);
  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    if (blocked.current) return false;
    if (draft.current.markdown === draft.current.saved) return true;
    if (!canEdit) return false;
    const work = async () => {
      try {
        while (draft.current.markdown !== draft.current.saved) {
          if (!navigator.onLine) throw new Error(texts.current.offline);
          const { markdown, version } = draft.current;
          if (markdown.length > 100000) throw new Error(texts.current.tooLong);
          if (mounted.current) { setError(""); }
          const body = JSON.stringify({ type: "update-note", id: list.id, markdown, version });
          const response = await apiFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: new TextEncoder().encode(body).length < 50000 });
          if (!response.ok) {
            if (response.status === 409) { blocked.current = true; if (mounted.current) setConflict(true); }
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error ?? texts.current.saveFailedDraft);
          }
          draft.current.saved = markdown;
          draft.current.version = version + 1;
          persist();
        }
        void client.invalidateQueries({ queryKey: [endpoint.startsWith("/api/shared/") ? "shared-workspace" : "workspace"] });
        return true;
      } catch (cause) {
        persist();
        if (mounted.current) { setError(cause instanceof Error ? cause.message : texts.current.saveFailed); }
        return false;
      }
    };
    inFlight.current = work();
    try { return await inFlight.current; } finally { inFlight.current = null; }
  }, [canEdit, client, endpoint, list.id, persist]);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [StarterKit.configure({ underline: false, link: { openOnClick: false, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } } }), Markdown, TaskList, TaskItem.configure({ nested: true }), Placeholder.configure({ placeholder: t.placeholder })],
    content: list.note?.markdown ?? "", contentType: "markdown", editable: canEdit,
    editorProps: {
      attributes: { class: "note-prose", role: "textbox", "aria-label": t.contentLabel, "aria-multiline": "true" },
      handleKeyDown: (_view, event) => slashKey.current(event),
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!event.clipboardData?.getData("text/html") && text && /(^#{1,6} |^[-*] |^\d+\. |\*\*|```|\[[^\]]+\]\(https?:)/m.test(text)) {
          editor?.commands.insertContent(text, { contentType: "markdown" });
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => changed.current(current),
    onSelectionUpdate: ({ editor: current }) => {
      const next = getSlash(current);
      slashRef.current = next; setSlash(next);
    },
  });
  useEffect(() => {
    changed.current = (current) => {
      draft.current.markdown = current.getMarkdown(); persist();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), 600);
      const next = getSlash(current);
      slashRef.current = next; setSlash(next);
    };
    slashKey.current = (event) => {
      const current = slashRef.current;
      if (!current || !editor) return false;
      const options = blockIds.map((id) => ({ id, label: texts.current.blocks[id] })).filter((block) => block.label.toLowerCase().includes(current.query.toLowerCase()));
      if (event.key === "Escape") { slashRef.current = null; setSlash(null); return true; }
      if (["ArrowUp", "ArrowDown"].includes(event.key) && options.length) {
        const next = { ...current, index: (current.index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length };
        slashRef.current = next; setSlash(next); return true;
      }
      if (event.key === "Enter" && options.length) {
        editor.commands.deleteRange({ from: current.from, to: current.to });
        formatBlock(editor, options[current.index % options.length].id);
        slashRef.current = null; setSlash(null); return true;
      }
      return false;
    };
  }, [editor, persist, save]);
  const restored = useRef(false);
  useEffect(() => {
    if (!editor || restored.current) return;
    restored.current = true;
    if (!canEdit) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const cached = JSON.parse(saved);
        if (typeof cached.markdown === "string" && cached.markdown.length <= 100000 && cached.markdown !== draft.current.saved) {
          draft.current.markdown = cached.markdown;
          editor.commands.setContent(cached.markdown, { contentType: "markdown", emitUpdate: false });
          // Restore status from external browser storage once the editor is ready.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          if (cached.version !== draft.current.version) { blocked.current = true; setConflict(true); setError(texts.current.localConflict); }
          else void save();
        }
      }
    } catch { /* Ignore unusable browser drafts. */ }
  }, [canEdit, editor, save, storageKey]);
  useEffect(() => {
    editor?.setEditable(canEdit, false);
    const incoming = list.note;
    if (!editor || !incoming || incoming.version <= draft.current.version || inFlight.current) return;
    if (draft.current.markdown !== draft.current.saved) {
      blocked.current = true; setConflict(true); setError(texts.current.remoteChanged);
    } else {
      draft.current = { markdown: incoming.markdown, saved: incoming.markdown, version: incoming.version };
      editor.commands.setContent(incoming.markdown, { contentType: "markdown", emitUpdate: false });
    }
  }, [canEdit, editor, list.note]);
  useEffect(() => {
    mounted.current = true;
    saveRef.current = save;
    const unload = (event: BeforeUnloadEvent) => { if (draft.current.markdown !== draft.current.saved) { event.preventDefault(); event.returnValue = ""; } };
    const retry = () => { void save(); };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("online", retry);
    return () => {
      mounted.current = false; saveRef.current = null;
      window.removeEventListener("beforeunload", unload); window.removeEventListener("online", retry);
      if (timer.current) clearTimeout(timer.current);
      void save();
    };
  }, [save, saveRef]);
  async function resolveConflict(keepLocal: boolean) {
    try {
      const response = await apiFetch(endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error(t.fetchLatestFailed);
      const workspace = await response.json();
      const latest = workspace.lists.find((item: TodoList) => item.id === list.id) as TodoList | undefined;
      if (!latest?.note || latest.role === "viewer") throw new Error(t.noEditRights);
      draft.current.version = latest.note.version;
      draft.current.saved = latest.note.markdown;
      if (!keepLocal) { draft.current.markdown = latest.note.markdown; editor?.commands.setContent(latest.note.markdown, { contentType: "markdown", emitUpdate: false }); }
      blocked.current = false; setConflict(false); setError(""); persist();
      if (keepLocal) await save();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.tryAgain); }
  }
  const download = useCallback(() => {
    const url = URL.createObjectURL(new Blob([draft.current.markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${list.name.replace(/[^\p{L}\p{N} _-]/gu, "") || texts.current.defaultFileName}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [list.name]);
  useEffect(() => {
    downloadRef.current = download;
    return () => { downloadRef.current = null; };
  }, [download, downloadRef]);
  const slashOptions = blocks.filter((block) => block.label.toLowerCase().includes(slash?.query.toLowerCase() ?? ""));
  return <div className="note-editor">
    {error && <Alert variant="destructive"><AlertDescription>{error}<div className="flex flex-wrap gap-2 mt-2">{conflict ? <><Button variant="outline" size="sm" onClick={() => void resolveConflict(false)}>{t.useLatest}</Button><Button variant="outline" size="sm" onClick={() => void resolveConflict(true)}>{t.keepMine}</Button></> : <Button variant="outline" size="sm" onClick={() => void save()}>{t.retrySave}</Button>}<Button variant="outline" size="sm" onClick={download}>{t.downloadDraft}</Button></div></AlertDescription></Alert>}
    <EditorContent editor={editor} />
    {slash && canEdit && <div className="note-slash" style={{ top: slash.top }} role="listbox" aria-label={t.insertBlock}>{slashOptions.length ? slashOptions.map((block, index) => <button role="option" aria-selected={index === slash.index} key={block.id} onMouseDown={(event) => event.preventDefault()} onClick={() => {
      if (!editor) return; editor.commands.deleteRange({ from: slash.from, to: slash.to }); formatBlock(editor, block.id); slashRef.current = null; setSlash(null);
    }}>{block.label}</button>) : <p>{t.noBlocks}</p>}</div>}
  </div>;
}
