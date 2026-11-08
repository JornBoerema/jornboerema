import { currentLanguage } from "@evido/i18n/react"
import { createEvidoAuthClient } from "@evido/auth/client"
import { API_URL } from "./api"

export const authClient = createEvidoAuthClient(API_URL, { language: currentLanguage })
