-- Uptime monitor for status.jornboerema.nl: a check per monitor per minute, and incidents.
CREATE TABLE "uptime_checks" (
    "id" BIGSERIAL NOT NULL,
    "monitor" TEXT NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "status" INTEGER,
    "latency_ms" INTEGER,
    "error" TEXT,

    CONSTRAINT "uptime_checks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "uptime_checks_monitor_checked_idx" ON "uptime_checks"("monitor", "checked_at");
CREATE INDEX "uptime_checks_checked_idx" ON "uptime_checks"("checked_at");

CREATE TABLE "uptime_incidents" (
    "id" TEXT NOT NULL,
    "monitor" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "cause" TEXT NOT NULL,

    CONSTRAINT "uptime_incidents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "uptime_incidents_monitor_started_idx" ON "uptime_incidents"("monitor", "started_at");
