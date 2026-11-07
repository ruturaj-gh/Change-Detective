/**
 * Stable local device ID management.
 *
 * The device ID is generated once and stored in a local config file
 * so it survives application restarts. It is NOT stored in the database
 * as the source of truth — the database row is seeded from this ID.
 *
 * File location: {cwd}/data/device-id.txt (created on first run).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = join(process.cwd(), "data");
const DEVICE_ID_FILE = join(DATA_DIR, "device-id.txt");

let cachedDeviceId: string | null = null;

export async function getOrCreateDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  try {
    const id = (await readFile(DEVICE_ID_FILE, "utf-8")).trim();
    if (isValidUuid(id)) {
      cachedDeviceId = id;
      return id;
    }
  } catch {
    // File doesn't exist yet — generate a new ID.
  }

  const newId = randomUUID();
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DEVICE_ID_FILE, newId, "utf-8");
  cachedDeviceId = newId;
  return newId;
}

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s
  );
}

