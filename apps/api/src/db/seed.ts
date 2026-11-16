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

  // Upsert the local device row.
  await prisma.device.upsert({
    where: { id: deviceId },
    create: {
      id: deviceId,
      name: hostname,
      osName,
      lastSeenAt: new Date(),
    },
    update: { lastSeenAt: new Date() },
  });

  // Upsert the settings row (id=1).
  const defaultRoot = process.platform === "win32" ? "C:\\" : homedir();
  const settings = await prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1, monitoredRoot: defaultRoot },
    update: {},
  });
  if (process.platform !== "win32" && settings.monitoredRoot === "C:\\") {
    await prisma.settings.update({
      where: { id: 1 },
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

