import { currentLanguage } from "@even/i18n/react"
import { createEvenAuthClient } from "@even/auth/client"
import { API_URL } from "./api"

export const authClient = createEvenAuthClient(API_URL, { language: currentLanguage })
