-- Whether new mail in this mailbox rings the user's devices. On for every mailbox until turned off.
ALTER TABLE "mail_connections" ADD COLUMN "notify" BOOLEAN NOT NULL DEFAULT true;
