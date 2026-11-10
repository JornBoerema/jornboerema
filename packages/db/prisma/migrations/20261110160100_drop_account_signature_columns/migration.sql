-- Replaced by mail_signatures. Applied once the app no longer reads these.
ALTER TABLE "mail_accounts" DROP COLUMN "signature_html",
DROP COLUMN "signature_for_new",
DROP COLUMN "signature_for_replies";
