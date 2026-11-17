/**
 * Database seed script.
 * Creates the single local device row and default settings row.
 * Safe to run multiple times (upsert semantics).
 *
 * Run with: npm run db:seed
 */
import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });
import { PrismaClient } from "@prisma/client";
import { getOrCreateDeviceId } from "../config/device-id.js";
import { homedir } from "node:os";
import { LEGACY_USER_ID } from "../auth/accounts.js";

const prisma = new PrismaClient();

async function seed() {
  const deviceId = await getOrCreateDeviceId();
  const hostname = (await import("node:os")).hostname();
  const osName =
    process.platform === "win32"
      ? "Windows"
      : process.platform === "darwin"
        ? "macOS"
        : process.platform === "linux"
          ? "Linux"
          : process.platform;

  await prisma.user.upsert({
    where: { id: LEGACY_USER_ID },
    create: {
      id: LEGACY_USER_ID,
      email: "legacy-owner@local.invalid",
      isLegacy: true,
    },
    update: {},
  });

  // Upsert the local device row.
  await prisma.device.upsert({
    where: { id: deviceId },
    create: {
      id: deviceId,
      userId: LEGACY_USER_ID,
      name: hostname,
      osName,
      lastSeenAt: new Date(),
    },
    update: { userId: LEGACY_USER_ID, lastSeenAt: new Date() },
  });

  // Upsert the local user's settings.
  const defaultRoot = process.platform === "win32" ? "C:\\" : homedir();
  const settings = await prisma.settings.upsert({
    where: { userId: LEGACY_USER_ID },
    create: { userId: LEGACY_USER_ID, monitoredRoot: defaultRoot },
    update: {},
  });
  if (process.platform !== "win32" && settings.monitoredRoot === "C:\\") {
    await prisma.settings.update({
      where: { userId: LEGACY_USER_ID },
      data: { monitoredRoot: defaultRoot },
    });
  }

  console.log(`✅ Seeded device ${deviceId} (${hostname}) and settings.`);
  await prisma.$disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

