import { createHmac, timingSafeEqual } from "node:crypto";
import type { onRequestHookHandler } from "fastify";
import { z } from "zod";
import { validatePasswordHash } from "./credentials.js";

export const SESSION_COOKIE_NAME = "change_detective_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/auth/login",
  "/api/auth/session",
  "/api/auth/logout",
]);
const AGENT_PATHS = [
  /^\/api\/agent\/enroll$/,
  /^\/api\/agent\/tasks\/next$/,
  /^\/api\/agent\/scans\/[0-9a-f-]{36}\/(?:heartbeat|results)$/i,
];

export interface AuthConfig {
  email: string;
  passwordHash: string;
  secret: string;
}

const EmailSchema = z.string().email().max(254);

export function loadAuthConfig(): AuthConfig | null {
  const email = process.env["AUTH_EMAIL"];
  const passwordHash = process.env["AUTH_PASSWORD_HASH"];
  const secret = process.env["AUTH_SECRET"];
  const isProduction = process.env["NODE_ENV"] === "production";

  if (!email && !passwordHash && !secret && !isProduction) {
    return null;
  }
  if (!email || !passwordHash || !secret) {
    throw new Error(
      "Set AUTH_EMAIL, AUTH_PASSWORD_HASH, and AUTH_SECRET together; all are required in production."
    );
  }
  if (!EmailSchema.safeParse(email).success) {
    throw new Error("AUTH_EMAIL must be a valid email address.");
  }
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 bytes.");
  }
  validatePasswordHash(passwordHash);

  return {
    email: email.trim().toLowerCase(),
    passwordHash,
    secret,
  };
}

interface SessionPayload {
  iss: "change-detective";
  sub: string;
  exp: number;
}

export function createSessionToken(
  email: string,
  secret: string,
  now = Date.now()
): string {
  const payload: SessionPayload = {
    iss: "change-detective",
    sub: email,
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );
  const signature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(
  token: string | undefined,
  config: AuthConfig,
  now = Date.now()
): boolean {
  if (!token || token.length > 2048) return false;
  const [encodedPayload, signature, ...rest] = token.split(".");
  if (!encodedPayload || !signature || rest.length !== 0) return false;

  const expectedSignature = Buffer.from(
    createHmac("sha256", config.secret)
      .update(encodedPayload)
      .digest("base64url")
  );
  const suppliedSignature = Buffer.from(signature);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return false;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    );
  } catch {
    return false;
  }

  if (!payload || typeof payload !== "object") return false;
  const session = payload as Partial<SessionPayload>;
  return (
    session.iss === "change-detective" &&
    session.sub === config.email &&
    typeof session.exp === "number" &&
    session.exp > Math.floor(now / 1000)
  );
}

export function createSessionGuard(
  config: AuthConfig | null
): onRequestHookHandler {
  return async (request, reply) => {
    if (!config) return;

    const requestPath = request.url.split("?")[0] ?? "";
    if (
      PUBLIC_PATHS.has(requestPath) ||
      AGENT_PATHS.some((path) => path.test(requestPath))
    ) {
      return;
    }

    const token = getSessionCookie(request.headers.cookie);
    if (!verifySessionToken(token, config)) {
      return reply.status(401).send({ error: "UNAUTHENTICATED" });
    }
  };
}

export function getSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const prefix = `${SESSION_COOKIE_NAME}=`;
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return cookie?.slice(prefix.length);
}

export function createSessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_TTL_SECONDS}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? "; Secure" : ""}`;
}
