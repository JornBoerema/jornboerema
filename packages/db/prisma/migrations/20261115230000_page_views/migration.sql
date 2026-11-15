-- Visitor statistics for the admin: cookieless page views with a daily-salted visitor hash.
CREATE TABLE "page_views" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "site" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "referrer" TEXT,
    "source" TEXT,
    "country" TEXT,
    "device" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "visitor" TEXT NOT NULL,

    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "page_views_created_idx" ON "page_views"("created_at");
CREATE INDEX "page_views_site_created_idx" ON "page_views"("site", "created_at");
