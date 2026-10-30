import { Check } from "@/components/icons";
export function Brand() {
  return (
    <div className="brand">
      <Check aria-hidden="true" className="size-5" strokeWidth={2.5} />
      <span>
        Even doen<span className="text-primary">.</span>
      </span>
    </div>
  );
}
