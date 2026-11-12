/** The Even mark: the orange tile with its dot, as on jornboerema.nl and in the desktop app. */
function EvenMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="even-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffb070" />
          <stop offset="0.55" stopColor="#f07a2b" />
          <stop offset="1" stopColor="#c94d12" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#even-fill)" />
      <circle cx="23.5" cy="23.5" r="3" fill="#fff4ea" />
    </svg>
  )
}

/** The brand as in Even doen and Even mailen, with the Even mark: the account belongs to every app. */
export function Brand() {
  return (
    <div className="brand">
      <EvenMark className="size-6" />
      <span>
        Even account<span className="text-primary">.</span>
      </span>
    </div>
  )
}
