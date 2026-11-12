import type { en } from "../en"
import { auth } from "./auth"
import { common } from "./common"
import { settings } from "./settings"
import { workspace } from "./workspace"

export const nl: typeof en = { common, auth, workspace, settings }
