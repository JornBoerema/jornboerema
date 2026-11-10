import { useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react"
import {
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  Link01Icon,
  QuoteDownIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  TextUnderlineIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import Placeholder from "@tiptap/extension-placeholder"
import { EditorContent, mergeAttributes, Node, useEditor, type Editor } from "@tiptap/react"
import { BubbleMenu, type BubbleMenuProps } from "@tiptap/react/menus"
import StarterKit from "@tiptap/starter-kit"
import { Button } from "@evido/ui/components/button"
import { cn } from "@evido/ui/lib/utils"
import { useI18n } from "@/i18n"
import { toEmailHtml } from "@/lib/email-compose"

// A new object here would make the menu update the editor on every render, without end.
const MENU_OPTIONS = { placement: "top", offset: 8 } as const

export type RichTextValue = {
  text: string
  html: string
  /** Something besides the signature has been written. */
  written: boolean
}

/** The signature as one block, so switching mailboxes can swap it whole. */
const Signature = Node.create({
  name: "signature",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML: () => [{ tag: "div[data-signature]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-signature": "" }), 0],
})

const signatureBlock = (html: string) => `<div data-signature>${html}</div>`

/** Puts `html` in place of the current signature; empty removes it. Not an undo step. */
function replaceSignature(editor: Editor, html: string) {
  let found: { from: number; to: number } | null = null
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === "signature") found = { from: offset, to: offset + node.nodeSize }
  })
  const range = found as { from: number; to: number } | null
  const chain = editor.chain().setMeta("addToHistory", false)
  const options = { updateSelection: false }
  if (range) {
    if (html) chain.insertContentAt(range, signatureBlock(html), options).run()
    else chain.deleteRange(range).run()
  } else if (html) {
    // A blank line keeps the signature apart from what is written above it.
    chain.insertContentAt(editor.state.doc.content.size, `<p></p>${signatureBlock(html)}`, options).run()
  }
}
export type RichTextHandle = { focus: () => void }

function FormatButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: IconSvgElement
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn("rounded-lg", active && "bg-accent text-accent-foreground")}
      // Keeps the text selected; a normal click would move focus off it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} aria-hidden="true" />
    </Button>
  )
}

function FormatMenu({
  editor,
  linkOpen,
  onLinkOpen,
}: {
  editor: Editor
  linkOpen: boolean
  onLinkOpen: (open: boolean) => void
}) {
  const t = useI18n().t.compose.format
  const [address, setAddress] = useState("")
  // The menu's visibility check runs outside React and needs the current value.
  const showingLink = useRef(linkOpen)
  useEffect(() => {
    showingLink.current = linkOpen
    if (linkOpen) setAddress((editor.getAttributes("link").href as string | undefined) ?? "")
  }, [linkOpen, editor])
  const shouldShow = useCallback<NonNullable<BubbleMenuProps["shouldShow"]>>(
    ({ editor: current, state }) => !state.selection.empty && (current.isFocused || showingLink.current),
    []
  )

  function closeLink() {
    onLinkOpen(false)
    editor.commands.focus()
  }

  function applyLink() {
    const href = address.trim()
    const chain = editor.chain().focus().extendMarkRange("link")
    if (href) chain.setLink({ href: /^[a-z][a-z\d+.-]*:/i.test(href) ? href : `https://${href}` }).run()
    else chain.unsetLink().run()
    onLinkOpen(false)
  }

  function onLinkKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault()
      applyLink()
    }
    if (event.key === "Escape") {
      // Marked as handled, so Escape doesn't also close the whole message.
      event.preventDefault()
      closeLink()
    }
  }

  const chain = () => editor.chain().focus()
  const actions = [
    { icon: TextBoldIcon, label: t.bold, mark: "bold", run: () => chain().toggleBold().run() },
    { icon: TextItalicIcon, label: t.italic, mark: "italic", run: () => chain().toggleItalic().run() },
    { icon: TextUnderlineIcon, label: t.underline, mark: "underline", run: () => chain().toggleUnderline().run() },
    { icon: TextStrikethroughIcon, label: t.strike, mark: "strike", run: () => chain().toggleStrike().run() },
    { icon: Link01Icon, label: t.link, mark: "link", run: () => onLinkOpen(true) },
    { icon: LeftToRightListBulletIcon, label: t.bulletList, mark: "bulletList", run: () => chain().toggleBulletList().run() },
    { icon: LeftToRightListNumberIcon, label: t.orderedList, mark: "orderedList", run: () => chain().toggleOrderedList().run() },
    { icon: QuoteDownIcon, label: t.quote, mark: "blockquote", run: () => chain().toggleBlockquote().run() },
  ]

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={shouldShow}
      options={MENU_OPTIONS}
    >
      <div className="flex items-center gap-0.5 rounded-xl border bg-popover p-1 text-popover-foreground shadow-md">
        {linkOpen ? (
          <input
            autoFocus
            type="url"
            aria-label={t.linkAddress}
            placeholder={t.linkAddress}
            className="h-7 w-64 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={onLinkKey}
          />
        ) : (
          actions.map((action) => (
            <FormatButton
              key={action.mark}
              icon={action.icon}
              label={action.label}
              active={editor.isActive(action.mark)}
              onClick={action.run}
            />
          ))
        )}
      </div>
    </BubbleMenu>
  )
}

/** Formatting appears on the selection, so the writing surface stays empty. */
export default function RichTextEditor({
  ref,
  label,
  placeholder,
  autoFocus,
  className,
  initialHtml,
  signature,
  onChange,
}: {
  ref?: Ref<RichTextHandle>
  label: string
  placeholder: string
  autoFocus?: boolean
  className?: string
  /** Content to start from, such as an opened draft. */
  initialHtml?: string
  /**
   * The signature to keep at the end. Starting content is assumed to have the
   * right one already; a later change swaps it.
   */
  signature?: string
  /** Also called once the editor is ready, with the starting content as it reads it. */
  onChange: (value: RichTextValue) => void
}) {
  const [linkOpen, setLinkOpen] = useState(false)
  const emit = ({ editor: current }: { editor: Editor }) => {
    const text = current.getText({ blockSeparator: "\n\n" }).replace(/\n{3,}/g, "\n\n").trim()
    let written = false
    current.state.doc.forEach((node) => {
      if (node.type.name !== "signature" && node.textContent.trim()) written = true
    })
    onChange({ text, html: text ? toEmailHtml(current.getHTML()) : "", written })
  }

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    // The start, so typing goes above a signature.
    autofocus: autoFocus ? "start" : false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false, defaultProtocol: "https" },
      }),
      Placeholder.configure({ placeholder }),
      Signature,
    ],
    editorProps: {
      attributes: { role: "textbox", "aria-label": label, "aria-multiline": "true" },
      handleKeyDown: (view, event) => {
        if (!(event.metaKey || event.ctrlKey)) return false
        // Sends the message through the form instead of adding a line break.
        if (event.key === "Enter") return true
        if (event.key.toLowerCase() === "k" && !view.state.selection.empty) {
          setLinkOpen(true)
          return true
        }
        return false
      },
    },
    content: initialHtml,
    onCreate: emit,
    onUpdate: emit,
  })

  const appliedSignature = useRef(initialHtml === undefined ? undefined : signature)
  useEffect(() => {
    if (!editor || signature === undefined || signature === appliedSignature.current) return
    appliedSignature.current = signature
    replaceSignature(editor, signature)
  }, [editor, signature])

  // Back where the cursor was, which is never inside the signature unless put there.
  useImperativeHandle(ref, () => ({ focus: () => editor?.commands.focus() }), [editor])

  return (
    <div className={cn("mail-editor", className)}>
      <EditorContent editor={editor} />
      {editor && <FormatMenu editor={editor} linkOpen={linkOpen} onLinkOpen={setLinkOpen} />}
    </div>
  )
}
