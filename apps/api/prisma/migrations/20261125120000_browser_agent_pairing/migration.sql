CREATE TABLE "agent_pairings" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "os_name" TEXT NOT NULL,
    "monitored_root" TEXT NOT NULL,
    "pairing_secret_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "user_id" UUID,
    "device_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "agent_pairings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_pairings_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_pairings_device_id_fkey"
        FOREIGN KEY ("device_id") REFERENCES "devices"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "agent_pairings_pairing_secret_hash_key"
    ON "agent_pairings"("pairing_secret_hash");
CREATE UNIQUE INDEX "agent_pairings_device_id_key"
    ON "agent_pairings"("device_id");
CREATE INDEX "agent_pairings_user_id_idx"
    ON "agent_pairings"("user_id");
CREATE INDEX "agent_pairings_status_expires_at_idx"
    ON "agent_pairings"("status", "expires_at");
