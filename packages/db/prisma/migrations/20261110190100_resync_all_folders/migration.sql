-- Applied once the code that syncs every folder is live. A cleared cursor starts
-- a full sync that keeps the rows already there, so the inbox stays visible.
UPDATE "mail_accounts" SET "sync_cursor" = NULL, "sync_since" = NULL;

-- Graph subscriptions only covered the inbox. Clearing them makes the next
-- renewal create one for all mail; the old one runs out on its own.
UPDATE "mail_accounts" SET "watch_id" = NULL, "watch_expires_at" = NULL WHERE "provider" = 'outlook';
