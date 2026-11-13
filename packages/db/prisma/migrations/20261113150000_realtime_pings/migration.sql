-- Neon Realtime: one counter per channel; clients watch their own row.
CREATE TABLE "realtime_pings" (
    "channel" TEXT NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realtime_pings_pkey" PRIMARY KEY ("channel")
);
