import { Note } from "@/components/icons";
export function Brand() {
  return (
    <div className="brand">
      <Note aria-hidden="true" className="size-5" strokeWidth={2.25} />
      <span>
        Even noteren<span className="text-primary">.</span>
      </span>
    </div>
  );
}
