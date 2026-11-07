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

const prisma = new PrismaClient();

async function seed() {
  const deviceId = await getOrCreateDeviceId();
  const os = process.env["OS"] ?? "Windows_NT";
  const hostname = (await import("node:os")).hostname();

  // Upsert the local device row.
  await prisma.device.upsert({
    where: { id: deviceId },
    create: {
      id: deviceId,
      name: hostname,
      osName: os.startsWith("Windows") ? "Windows" : os,
      lastSeenAt: new Date(),
    },
    update: { lastSeenAt: new Date() },
  });

  // Upsert the settings row (id=1).
  await prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });

  console.log(`✅ Seeded device ${deviceId} (${hostname}) and settings.`);
  await prisma.$disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

