import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_BYTES,
      { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      }
    );
  });
}

function parsePasswordHash(encoded: string): { salt: Buffer; key: Buffer } {
  const [algorithm, cost, blockSize, parallelization, saltHex, keyHex, ...rest] =
    encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    cost !== String(SCRYPT_COST) ||
    blockSize !== String(SCRYPT_BLOCK_SIZE) ||
    parallelization !== String(SCRYPT_PARALLELIZATION) ||
    rest.length !== 0 ||
    !saltHex ||
    !keyHex ||
    !/^[0-9a-f]{32}$/i.test(saltHex) ||
    !/^[0-9a-f]{128}$/i.test(keyHex)
  ) {
    throw new Error("AUTH_PASSWORD_HASH is not a valid Change Detective scrypt hash.");
  }
  return { salt: Buffer.from(saltHex, "hex"), key: Buffer.from(keyHex, "hex") };
}

export function validatePasswordHash(encoded: string): void {
  parsePasswordHash(encoded);
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 256) {
    throw new Error("Password must be between 12 and 256 characters.");
  }

  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt);
  return [
    "scrypt",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("hex"),
    key.toString("hex"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encodedHash: string
): Promise<boolean> {
  const { salt, key } = parsePasswordHash(encodedHash);
  const candidate = await deriveKey(password, salt);
  return timingSafeEqual(candidate, key);
}
