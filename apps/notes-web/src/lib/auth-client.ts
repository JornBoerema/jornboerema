import { currentLanguage } from "@evido/i18n/react"
import { createEvidoAuthClient } from "@evido/auth/client"
import { API_URL } from "./api"

// Auth e-mails (verification, password reset) follow the chosen language.
export const authClient = createEvidoAuthClient(API_URL, { language: currentLanguage })
