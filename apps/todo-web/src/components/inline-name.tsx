
import { useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  label: string;
  maxLength: number;
  disabled: boolean;
  heading?: boolean;
  className?: string;
  onSave: (value: string) => Promise<boolean>;
};

export function InlineName({ value, label, maxLength, disabled, heading, className, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [initialText, setInitialText] = useState(value);
  const [error, setError] = useState("");
  const input = useRef<HTMLElement>(null);
  const finishing = useRef(false);
  useEffect(() => {
    if (editing && input.current) {
      input.current.textContent = initialText;
      input.current.focus();
      const range = document.createRange();
      range.selectNodeContents(input.current);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  }, [editing, initialText]);
  function start() {
    if (disabled) return;
    finishing.current = false;
    setInitialText(value);
    setError("");
    setEditing(true);
  }
  async function save() {
    if (finishing.current || disabled) return;
    const text = (input.current?.textContent ?? "").replace(/\s*\n\s*/g, " ").trim();
    if (text.length > maxLength) { setError(`Gebruik maximaal ${maxLength} tekens.`); input.current?.focus(); return; }
    if (!text) { setError("Vul een naam in."); input.current?.focus(); return; }
    finishing.current = true;
    if (text === value || await onSave(text)) setEditing(false);
    else { finishing.current = false; setError("Opslaan is niet gelukt. Probeer het opnieuw."); }
  }
  const Tag = heading ? "h1" : "span";
  return (
    <Tag className={className} onDoubleClick={editing ? undefined : start} title={disabled || editing ? undefined : "Dubbelklik om te bewerken"}>
      {editing ? (
        <>
          <span ref={(node) => { input.current = node; }}
            role="textbox" aria-label={label} aria-invalid={!!error} aria-multiline={false}
            contentEditable={!disabled ? "plaintext-only" : false} suppressContentEditableWarning
            className="inline-text-editor"
            onInput={() => setError("")}
            onBlur={() => void save()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") { event.preventDefault(); void save(); }
              if (event.key === "Escape") { event.preventDefault(); finishing.current = true; setEditing(false); }
            }}>
          </span>
          {error && <span role="alert" className="block text-sm text-destructive">{error}</span>}
        </>
      ) : value}
    </Tag>
  );
}
