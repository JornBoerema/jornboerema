-- Better Auth distinguishes null ("unrestricted") from an empty list on these
-- optional OAuth arrays. Prisma lists cannot be null, so store them as jsonb.
-- Existing values are converted in place; nothing is dropped.

ALTER TABLE "oauth_client"
  ALTER COLUMN "scopes" TYPE JSONB USING to_jsonb("scopes"),
  ALTER COLUMN "client_credentials_scopes" DROP DEFAULT,
  ALTER COLUMN "client_credentials_scopes" TYPE JSONB USING to_jsonb("client_credentials_scopes"),
  ALTER COLUMN "contacts" TYPE JSONB USING to_jsonb("contacts"),
  ALTER COLUMN "post_logout_redirect_uris" TYPE JSONB USING to_jsonb("post_logout_redirect_uris"),
  ALTER COLUMN "grant_types" TYPE JSONB USING to_jsonb("grant_types"),
  ALTER COLUMN "response_types" TYPE JSONB USING to_jsonb("response_types");

ALTER TABLE "oauth_resource"
  ALTER COLUMN "allowed_scopes" TYPE JSONB USING to_jsonb("allowed_scopes");

ALTER TABLE "oauth_access_token"
  ALTER COLUMN "resources" TYPE JSONB USING to_jsonb("resources"),
  ALTER COLUMN "requested_user_info_claims" TYPE JSONB USING to_jsonb("requested_user_info_claims");

ALTER TABLE "oauth_refresh_token"
  ALTER COLUMN "resources" TYPE JSONB USING to_jsonb("resources"),
  ALTER COLUMN "requested_user_info_claims" TYPE JSONB USING to_jsonb("requested_user_info_claims");

ALTER TABLE "oauth_consent"
  ALTER COLUMN "resources" TYPE JSONB USING to_jsonb("resources"),
  ALTER COLUMN "requested_user_info_claims" TYPE JSONB USING to_jsonb("requested_user_info_claims");
