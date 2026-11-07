-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "os_name" TEXT NOT NULL DEFAULT 'Windows',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "last_seen_at" TIMESTAMPTZ,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "monitored_root" TEXT NOT NULL DEFAULT 'C:\',
    "scan_interval_minutes" INTEGER NOT NULL DEFAULT 360,
    "low_space_threshold_percent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "history_retention_days" INTEGER NOT NULL DEFAULT 90,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "settings_id_check" CHECK ("id" = 1),
    CONSTRAINT "settings_scan_interval_minutes_check"
        CHECK ("scan_interval_minutes" BETWEEN 15 AND 10080),
    CONSTRAINT "settings_low_space_threshold_percent_check"
        CHECK ("low_space_threshold_percent" BETWEEN 0 AND 100),
    CONSTRAINT "settings_history_retention_days_check"
        CHECK ("history_retention_days" BETWEEN 1 AND 3650)
);

-- CreateTable
CREATE TABLE "scans" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "root_path" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "completed_at" TIMESTAMPTZ,
    "total_bytes" TEXT,
    "free_bytes" TEXT,
    "scanned_directory_count" INTEGER NOT NULL DEFAULT 0,
    "inaccessible_directory_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scans_trigger_type_check"
        CHECK ("trigger_type" IN ('manual', 'scheduled')),
    CONSTRAINT "scans_status_check"
        CHECK ("status" IN ('queued','running','completed','partial','failed','cancelled'))
);

-- CreateTable
CREATE TABLE "directory_snapshots" (
    "scan_id" UUID NOT NULL,
    "normalized_path" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "size_bytes" TEXT NOT NULL,
    "files_count" TEXT,
    "directories_count" TEXT,
    "measurement_complete" BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT "directory_snapshots_pkey" PRIMARY KEY ("scan_id","normalized_path")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "scan_id" UUID,
    "finding_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "findings_severity_check"
        CHECK ("severity" IN ('info','warning','critical'))
);

-- CreateIndex
CREATE INDEX "scans_device_started_idx" ON "scans"("device_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "findings_device_created_idx" ON "findings"("device_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directory_snapshots" ADD CONSTRAINT "directory_snapshots_scan_id_fkey"
    FOREIGN KEY ("scan_id") REFERENCES "scans"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_scan_id_fkey"
    FOREIGN KEY ("scan_id") REFERENCES "scans"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default settings row (safe to run multiple times)
INSERT INTO "settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

