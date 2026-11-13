-- Billing through Stripe: the customer per user, and their subscriptions.
ALTER TABLE "user" ADD COLUMN "stripe_customer_id" TEXT;

CREATE TABLE "subscription" (
    "id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'incomplete',
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "trial_start" TIMESTAMP(3),
    "trial_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN DEFAULT false,
    "cancel_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "seats" INTEGER,
    "billing_interval" TEXT,
    "stripe_schedule_id" TEXT,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "subscription_reference_id_idx" ON "subscription"("reference_id");
CREATE INDEX "subscription_stripe_subscription_id_idx" ON "subscription"("stripe_subscription_id");
