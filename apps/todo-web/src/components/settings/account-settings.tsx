import { useRef, useState } from "react"
import { useNavigate } from "react-router"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import { webUrl } from "@/lib/api"
import { Mail, Trash2 } from "@/components/icons"
import { SettingsRow, SettingsSection } from "@evido/ui/components/settings-dialog"
import { Button } from "@evido/ui/components/button"
import { Input } from "@evido/ui/components/input"
import { Field, FieldGroup, FieldLabel } from "@evido/ui/components/field"
import { Alert, AlertDescription } from "@evido/ui/components/alert"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@evido/ui/components/alert-dialog"

export function AccountSettings({ user }: { user: { name: string; email: string } }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [savedName, setSavedName] = useState(user.name)
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [busy, setBusy] = useState<string | null>(null)
  const inFlight = useRef(false)
  const [emailSent, setEmailSent] = useState("")
  const [resetSent, setResetSent] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [password, setPassword] = useState("")
  const [deleteError, setDeleteError] = useState("")

  async function perform(action: string, work: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(action)
    try {
      await work()
    } catch {
      if (action === "delete")
        setDeleteError("Verwijderen is niet gelukt. Controleer je wachtwoord en probeer het opnieuw.")
      else toast.error("Dit is niet gelukt. Probeer het opnieuw.")
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  const nextName = name.trim()
  const nextEmail = email.trim().toLowerCase()
  const emailUnchanged =
    !nextEmail || nextEmail === user.email.toLowerCase() || nextEmail === emailSent

  return (
    <>
      <SettingsSection title="Profiel" description="Zo zien anderen je in gedeelde lijsten.">
        <SettingsRow title="Naam" htmlFor="profile-name">
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault()
              if (!nextName || nextName === savedName) return
              void perform("name", async () => {
                const result = await authClient.updateUser({ name: nextName })
                if (result.error) throw new Error()
                setSavedName(nextName)
                setName(nextName)
                toast.success("Je profiel is bijgewerkt.")
              })
            }}
          >
            <Input
              id="profile-name"
              className="sm:w-60"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              disabled={!!busy}
            />
            <Button type="submit" disabled={!!busy || !nextName || nextName === savedName}>
              {busy === "name" ? "Opslaan…" : "Opslaan"}
            </Button>
          </form>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Inloggen" description="Voor inloggen en e-mails over je account.">
        <SettingsRow
          title="E-mailadres"
          htmlFor="profile-email"
          description="Je nieuwe adres wordt actief zodra je het via e-mail bevestigt."
          footer={
            emailSent && (
              <Alert role="status">
                <Mail />
                <AlertDescription>
                  Bevestig de wijziging via de e-mail aan {emailSent}. Tot die tijd blijft je
                  huidige adres actief.
                </AlertDescription>
              </Alert>
            )
          }
        >
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault()
              if (emailUnchanged) return
              void perform("email", async () => {
                const result = await authClient.changeEmail({
                  newEmail: nextEmail,
                  callbackURL: webUrl("/?instellingen=account"),
                })
                if (result.error) throw new Error()
                setEmailSent(nextEmail)
              })
            }}
          >
            <Input
              id="profile-email"
              className="sm:w-60"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
              disabled={!!busy}
            />
            <Button type="submit" variant="outline" disabled={!!busy || emailUnchanged}>
              {busy === "email" ? "Versturen…" : "Wijzigen"}
            </Button>
          </form>
        </SettingsRow>
        <SettingsRow
          title="Wachtwoord"
          description={
            <>
              We sturen een herstellink naar <strong className="font-medium text-foreground">{user.email}</strong>.
            </>
          }
          footer={
            resetSent && (
              <Alert role="status">
                <Mail />
                <AlertDescription>
                  De herstellink is verstuurd. Bekijk je inbox en eventueel je spammap.
                </AlertDescription>
              </Alert>
            )
          }
        >
          <Button
            variant="outline"
            disabled={!!busy || resetSent}
            onClick={() =>
              void perform("reset", async () => {
                const result = await authClient.requestPasswordReset({
                  email: user.email,
                  redirectTo: webUrl("/wachtwoord-herstellen"),
                })
                if (result.error) throw new Error()
                setResetSent(true)
              })
            }
          >
            <Mail data-icon="inline-start" />
            {busy === "reset" ? "Versturen…" : resetSent ? "Verstuurd" : "Stuur herstellink"}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Gevarenzone" destructive>
        <SettingsRow
          title="Account verwijderen"
          destructive
          description="Je profiel wordt verwijderd, net als workspaces waarvan jij eigenaar bent, met al hun lijsten. Ook voor de andere leden."
        >
          <Button variant="destructive" disabled={!!busy} onClick={() => setDeleting(true)}>
            <Trash2 data-icon="inline-start" />
            Verwijderen
          </Button>
        </SettingsRow>
      </SettingsSection>

      <AlertDialog
        open={deleting}
        onOpenChange={(open) => {
          if (busy) return
          setDeleting(open)
          setPassword("")
          setDeleteError("")
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Je account definitief verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              Workspaces waarvan jij eigenaar bent verdwijnen met al hun lijsten, ook voor de andere
              leden. Workspaces van anderen blijven bestaan. Vul je wachtwoord in om te bevestigen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form
            className="flex flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault()
              if (!password) return
              setDeleteError("")
              void perform("delete", async () => {
                const result = await authClient.deleteUser({ password })
                if (result.error) throw new Error()
                client.clear()
                toast.success("Je account is verwijderd.")
                navigate("/inloggen", { replace: true })
              })
            }}
          >
            <FieldGroup>
              <Field data-invalid={!!deleteError}>
                <FieldLabel htmlFor="delete-password">Huidig wachtwoord</FieldLabel>
                <Input
                  id="delete-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setDeleteError("")
                  }}
                  required
                  disabled={!!busy}
                  aria-invalid={!!deleteError}
                  aria-describedby={deleteError ? "delete-error" : undefined}
                />
              </Field>
            </FieldGroup>
            {deleteError && (
              <p id="delete-error" role="alert" className="text-sm text-destructive">
                {deleteError}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={!!busy}>
                Annuleren
              </AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={!!busy || !password}>
                {busy === "delete" ? "Verwijderen…" : "Definitief verwijderen"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
