ALTER TABLE "devices"
    ADD COLUMN "monitored_root" TEXT,
    ADD COLUMN "agent_token_hash" TEXT;

ALTER TABLE "scans"
    ADD COLUMN "agent_lease_until" TIMESTAMPTZ;

CREATE UNIQUE INDEX "devices_agent_token_hash_key"
    ON "devices"("agent_token_hash");

CREATE UNIQUE INDEX "devices_single_agent_idx"
    ON "devices" ((TRUE))
    WHERE "agent_token_hash" IS NOT NULL;

CREATE TABLE "agent_enrollments" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "agent_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_enrollments_token_hash_key"
    ON "agent_enrollments"("token_hash");

CREATE INDEX "agent_enrollments_expires_at_idx"
    ON "agent_enrollments"("expires_at");
