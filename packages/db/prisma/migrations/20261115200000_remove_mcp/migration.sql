-- The MCP server for Even doen is gone, and with it Better Auth's OAuth provider
-- and JWT plugins: their tables go too.
DROP TABLE IF EXISTS "oauth_client_assertion";
DROP TABLE IF EXISTS "oauth_consent";
DROP TABLE IF EXISTS "oauth_access_token";
DROP TABLE IF EXISTS "oauth_refresh_token";
DROP TABLE IF EXISTS "oauth_client_resource";
DROP TABLE IF EXISTS "oauth_resource";
DROP TABLE IF EXISTS "oauth_client";
DROP TABLE IF EXISTS "jwks";
