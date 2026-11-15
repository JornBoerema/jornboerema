import { REGEXP_ONLY_DIGITS } from "input-otp"
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@even/ui/components/input-otp"

/**
 * A 6-digit code from an authenticator app, as six boxes across the form's width.
 * Pasting the whole code and the browser's one-time-code autofill both work.
 */
export function CodeInput({
  id,
  name,
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  autoFocus,
}: {
  id?: string
  name?: string
  value: string
  onChange: (value: string) => void
  /** All six digits are in. */
  onComplete?: (value: string) => void
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
}) {
  const slot = "h-12 flex-1 text-lg font-medium tabular-nums"
  return (
    <InputOTP
      id={id}
      name={name}
      maxLength={6}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-invalid={invalid}
      containerClassName="w-full gap-2"
    >
      <InputOTPGroup className="flex-1">
        {[0, 1, 2].map((index) => (
          <InputOTPSlot key={index} index={index} className={slot} aria-invalid={invalid} />
        ))}
      </InputOTPGroup>
      <InputOTPSeparator className="text-muted-foreground" />
      <InputOTPGroup className="flex-1">
        {[3, 4, 5].map((index) => (
          <InputOTPSlot key={index} index={index} className={slot} aria-invalid={invalid} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  )
}
