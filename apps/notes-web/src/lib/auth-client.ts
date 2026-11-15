import { currentLanguage } from "@even/i18n/react"
import { createEvenAuthClient } from "@even/auth/client"
import { API_URL } from "./api"

// Auth e-mails (verification, password reset) follow the chosen language.
export const authClient = createEvenAuthClient(API_URL, { language: currentLanguage })
