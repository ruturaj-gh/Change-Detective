CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMPTZ,
    "privacy_notice_version" TEXT,
    "privacy_accepted_at" TIMESTAMPTZ,
    "session_version" INTEGER NOT NULL DEFAULT 0,
    "is_legacy" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

INSERT INTO "users" (
    "id", "email", "is_legacy"
) VALUES (
    '00000000-0000-4000-8000-000000000001',
    'legacy-owner@local.invalid',
    true
);

CREATE TABLE "account_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "account_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_tokens_purpose_check"
        CHECK ("purpose" IN ('verify_email', 'reset_password'))
);

CREATE UNIQUE INDEX "account_tokens_token_hash_key"
    ON "account_tokens"("token_hash");
CREATE INDEX "account_tokens_user_id_purpose_idx"
    ON "account_tokens"("user_id", "purpose");
CREATE INDEX "account_tokens_expires_at_idx"
    ON "account_tokens"("expires_at");

ALTER TABLE "settings" DROP CONSTRAINT "settings_id_check";
ALTER TABLE "settings" ALTER COLUMN "id" TYPE INTEGER;
ALTER TABLE "settings" ALTER COLUMN "id" DROP DEFAULT;
CREATE SEQUENCE "settings_id_seq" OWNED BY "settings"."id";
SELECT setval(
    '"settings_id_seq"',
    COALESCE((SELECT MAX("id") FROM "settings"), 0) + 1,
    false
);
ALTER TABLE "settings"
    ALTER COLUMN "id" SET DEFAULT nextval('"settings_id_seq"');

ALTER TABLE "devices" ADD COLUMN "user_id" UUID;
ALTER TABLE "settings" ADD COLUMN "user_id" UUID;
ALTER TABLE "agent_enrollments" ADD COLUMN "user_id" UUID;

UPDATE "devices"
SET "user_id" = '00000000-0000-4000-8000-000000000001';
UPDATE "settings"
SET "user_id" = '00000000-0000-4000-8000-000000000001';
DELETE FROM "agent_enrollments";

ALTER TABLE "devices" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "settings" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "agent_enrollments" ALTER COLUMN "user_id" SET NOT NULL;

CREATE INDEX "devices_user_created_idx" ON "devices"("user_id", "created_at");
CREATE UNIQUE INDEX "settings_user_id_key" ON "settings"("user_id");

ALTER TABLE "devices"
    ADD CONSTRAINT "devices_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settings"
    ADD CONSTRAINT "settings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_enrollments"
    ADD CONSTRAINT "agent_enrollments_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scans"
    DROP CONSTRAINT "scans_device_id_fkey",
    ADD CONSTRAINT "scans_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "findings"
    DROP CONSTRAINT "findings_device_id_fkey",
    ADD CONSTRAINT "findings_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "devices_single_agent_idx";
