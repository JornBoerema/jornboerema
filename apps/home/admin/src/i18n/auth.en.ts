// Keys are shared with auth.nl.ts.
export const auth = {
  layout: {
    homeLabel: "Admin, go to sign in",
    tagline: "jornboerema.nl",
  },
  pageTitles: {
    login: "Sign in",
    register: "Sign up",
    forgot: "Forgot password",
    reset: "Reset password",
  },
  login: {
    title: "Admin",
    description: "Sign in to manage the Even apps.",
    action: "Sign in",
  },
  register: {
    title: "All your mail together",
    description: "Create an account to connect your mailboxes.",
    action: "Create account",
  },
  forgot: {
    title: "Forgot your password?",
    description: "We'll send you a link to choose a new password.",
    action: "Send reset link",
  },
  reset: {
    title: "A new password",
    description: "Choose a new password for your account.",
    action: "Save password",
  },
  errors: {
    invalidCredentials: "Your email address or password is incorrect.",
    emailNotVerified: "Please confirm your email address first. We've sent you a new confirmation link.",
    tooManyRequests: "Too many attempts. Please wait a moment and try again.",
    invalidToken: "This link is invalid or has expired. Request a new link.",
    passwordTooShort: "Use at least 8 characters for your password.",
    generic: "That didn't work. Check your details and try again.",
    passwordMismatch: "The passwords don't match.",
  },
  sent: {
    title: "Check your inbox",
    register: "If this address isn't registered yet, you'll receive a link to confirm your account. Then you can get started right away.",
    forgot: "If an account exists for this email address, you'll receive a reset link. The link is valid for one hour.",
    spam: "Nothing received? Check your spam folder too.",
  },
  passwordChanged: {
    title: "Password changed",
    description: "You can sign in with your new password.",
  },
  verificationExpired: {
    title: "Confirmation link expired",
    description: "Sign in below to receive a new confirmation link.",
  },
  invalidReset: {
    title: "This link is invalid or has expired",
    action: "Request a new reset link.",
  },
  fields: {
    name: "Name",
    namePlaceholder: "Your name",
    email: "Email address",
    emailPlaceholder: "you@example.com",
    password: "Password",
    forgot: "Forgot?",
    passwordHint: "At least 8 characters.",
    remember: "Stay signed in",
    confirm: "Repeat password",
  },
  switch: {
    noAccount: "No account yet?",
    createAccount: "Create an account",
    haveAccount: "Already have an account?",
    signIn: "Sign in",
    backToSignIn: "Back to sign in",
  },
}
