-- First-run steps: new users go to /welcome until they finish or skip them.
ALTER TABLE "user" ADD COLUMN "onboarded_at" TIMESTAMP(3);

-- Everyone who is here already has found their way: they skip the steps.
UPDATE "user" SET "onboarded_at" = "created_at";

-- A mailbox connected from the first-run steps comes back there, not to the mail app.
ALTER TABLE "mail_oauth_states" ADD COLUMN "return_to" TEXT;
