-- CreateEnum
CREATE TYPE "ListKind" AS ENUM ('todo', 'shopping', 'note');

-- CreateEnum
CREATE TYPE "ShareRole" AS ENUM ('viewer', 'editor');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "last_request" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "rate_limit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jwks" (
    "id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "private_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "alg" TEXT,
    "crv" TEXT,

    CONSTRAINT "jwks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_client" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT,
    "client_discovery_id" TEXT,
    "disabled" BOOLEAN DEFAULT false,
    "skip_consent" BOOLEAN,
    "enable_end_session" BOOLEAN,
    "subject_type" TEXT,
    "scopes" TEXT[],
    "client_credentials_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "user_id" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "name" TEXT,
    "uri" TEXT,
    "icon" TEXT,
    "contacts" TEXT[],
    "tos" TEXT,
    "policy" TEXT,
    "software_id" TEXT,
    "software_version" TEXT,
    "software_statement" TEXT,
    "redirect_uris" TEXT[],
    "post_logout_redirect_uris" TEXT[],
    "backchannel_logout_uri" TEXT,
    "backchannel_logout_session_required" BOOLEAN,
    "token_endpoint_auth_method" TEXT,
    "application_type" TEXT,
    "jwks" TEXT,
    "jwks_uri" TEXT,
    "grant_types" TEXT[],
    "response_types" TEXT[],
    "require_p_k_c_e" BOOLEAN,
    "dpop_bound_access_tokens" BOOLEAN DEFAULT false,
    "reference_id" TEXT,
    "metadata" JSONB,

    CONSTRAINT "oauth_client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_resource" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "access_token_ttl" INTEGER,
    "refresh_token_ttl" INTEGER,
    "signing_algorithm" TEXT,
    "signing_key_id" TEXT,
    "allowed_scopes" TEXT[],
    "custom_claims" JSONB,
    "dpop_bound_access_tokens_required" BOOLEAN DEFAULT false,
    "disabled" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "policy_version" INTEGER DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "oauth_resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_client_resource" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3),

    CONSTRAINT "oauth_client_resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_refresh_token" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "session_id" TEXT,
    "user_id" TEXT NOT NULL,
    "reference_id" TEXT,
    "authorization_code_id" TEXT,
    "resources" TEXT[],
    "requested_user_info_claims" TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "revoked" TIMESTAMP(3),
    "rotated_at" TIMESTAMP(3),
    "rotation_replay_response" TEXT,
    "rotation_replay_expires_at" TIMESTAMP(3),
    "auth_time" TIMESTAMP(3),
    "confirmation" JSONB,
    "scopes" TEXT[],

    CONSTRAINT "oauth_refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_access_token" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "session_id" TEXT,
    "user_id" TEXT,
    "reference_id" TEXT,
    "authorization_code_id" TEXT,
    "resources" TEXT[],
    "requested_user_info_claims" TEXT[],
    "refresh_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "revoked" TIMESTAMP(3),
    "confirmation" JSONB,
    "scopes" TEXT[],

    CONSTRAINT "oauth_access_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_consent" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT,
    "reference_id" TEXT,
    "resources" TEXT[],
    "requested_user_info_claims" TEXT[],
    "scopes" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_client_assertion" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_client_assertion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lists" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ListKind" NOT NULL DEFAULT 'todo',
    "note_content" TEXT NOT NULL DEFAULT '',
    "note_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "todos" (
    "id" TEXT NOT NULL,
    "list_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shopping" JSONB,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "in_progress" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "todos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "list_links" (
    "list_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "ShareRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "list_links_pkey" PRIMARY KEY ("list_id")
);

-- CreateTable
CREATE TABLE "list_members" (
    "id" TEXT NOT NULL,
    "list_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "ShareRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "list_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "list_invitations" (
    "id" TEXT NOT NULL,
    "list_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "ShareRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "list_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_user_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "account_user_idx" ON "account"("user_id");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_key_key" ON "rate_limit"("key");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_client_client_id_key" ON "oauth_client"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_resource_identifier_key" ON "oauth_resource"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_client_resource_unique" ON "oauth_client_resource"("client_id", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_refresh_token_token_key" ON "oauth_refresh_token"("token");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_access_token_token_key" ON "oauth_access_token"("token");

-- CreateIndex
CREATE INDEX "lists_user_idx" ON "lists"("user_id");

-- CreateIndex
CREATE INDEX "todos_list_idx" ON "todos"("list_id");

-- CreateIndex
CREATE UNIQUE INDEX "list_links_token_key" ON "list_links"("token");

-- CreateIndex
CREATE INDEX "list_members_user_idx" ON "list_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "list_members_list_user_unique" ON "list_members"("list_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "list_invitations_token_hash_key" ON "list_invitations"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "list_invitations_list_email_unique" ON "list_invitations"("list_id", "email");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "oauth_resource"("identifier") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_refresh_id_fkey" FOREIGN KEY ("refresh_id") REFERENCES "oauth_refresh_token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lists" ADD CONSTRAINT "lists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "todos" ADD CONSTRAINT "todos_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_links" ADD CONSTRAINT "list_links_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_members" ADD CONSTRAINT "list_members_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_members" ADD CONSTRAINT "list_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_invitations" ADD CONSTRAINT "list_invitations_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
