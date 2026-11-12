import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";

/**
 * Markdown description of an issue. Saves a moment after typing stops and on
 * blur; changes from others come in while it isn't being edited.
 */
export default function DescriptionEditor({ value, onSave, editable, placeholder, label }: {
  value: string;
  onSave: (markdown: string) => void;
  editable: boolean;
  placeholder: string;
  label: string;
}) {
  const saved = useRef(value);
  const latest = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  }, [onSave]);
  const flush = (markdown: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (markdown === saved.current) return;
    saved.current = markdown;
    save.current(markdown);
  };
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ underline: false, link: { openOnClick: false, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } } }),
      Markdown,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    contentType: "markdown",
    editable,
    editorProps: { attributes: { class: "note-prose issue-prose", role: "textbox", "aria-label": label, "aria-multiline": "true" } },
    onUpdate: ({ editor: current }) => {
      latest.current = current.getMarkdown();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(latest.current), 800);
    },
    onBlur: ({ editor: current }) => flush(current.getMarkdown()),
  });
  // Someone else changed it: show theirs, unless this editor is in use.
  useEffect(() => {
    if (!editor || editor.isFocused || value === saved.current) return;
    saved.current = value;
    latest.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);
  useEffect(() => editor?.setEditable(editable), [editor, editable]);
  // Closing the issue mid-sentence still saves it.
  useEffect(() => () => flush(latest.current), []);
  return <EditorContent editor={editor} />;
}
