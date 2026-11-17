import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { onRequestHookHandler } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";

export const SESSION_COOKIE_NAME = "change_detective_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const GOOGLE_STATE_COOKIE_NAME = "change_detective_google_state";

const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/auth/google",
  "/api/auth/google/callback",
  "/api/auth/session",
  "/api/auth/logout",
]);
const AGENT_PATHS = [
  /^\/api\/agent\/enroll$/,
  /^\/api\/agent\/tasks\/next$/,
  /^\/api\/agent\/scans\/[0-9a-f-]{36}\/(?:heartbeat|results)$/i,
];

export interface AuthConfig {
  secret: string;
  publicAppUrl: string;
  googleClientId?: string;
  googleClientSecret?: string;
  bootstrapEmail?: string;
}

export function loadAuthConfig(): AuthConfig {
  const secret = process.env["AUTH_SECRET"];
  const isProduction = process.env["NODE_ENV"] === "production";
  const googleClientId = process.env["GOOGLE_CLIENT_ID"];
  const googleClientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const publicAppUrl = process.env["PUBLIC_APP_URL"] ?? "http://localhost:3000";
  const bootstrapEmail = process.env["BOOTSTRAP_EMAIL"]?.trim().toLowerCase();

  if (isProduction && !secret) {
    throw new Error("AUTH_SECRET is required in production.");
  }
  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET together.");
  }
  if (isProduction && (!googleClientId || !googleClientSecret)) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required in production."
    );
  }
  let parsedPublicUrl: URL;
  try {
    parsedPublicUrl = new URL(publicAppUrl);
  } catch {
    throw new Error("PUBLIC_APP_URL must be a valid URL.");
  }
  if (!["http:", "https:"].includes(parsedPublicUrl.protocol)) {
    throw new Error("PUBLIC_APP_URL must use HTTP or HTTPS.");
  }
  if (isProduction && parsedPublicUrl.protocol !== "https:") {
    throw new Error("PUBLIC_APP_URL must be an HTTPS URL in production.");
  }
  if (bootstrapEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bootstrapEmail)) {
    throw new Error("BOOTSTRAP_EMAIL must be a valid email address.");
  }
  if (secret && Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 bytes.");
  }

  return {
    secret: secret ?? randomBytes(32).toString("hex"),
    publicAppUrl: parsedPublicUrl.origin,
    ...(googleClientId ? { googleClientId } : {}),
    ...(googleClientSecret ? { googleClientSecret } : {}),
    ...(bootstrapEmail ? { bootstrapEmail } : {}),
  };
}

const SessionPayloadSchema = z.object({
  iss: z.literal("change-detective"),
  sub: z.string().uuid(),
  sv: z.number().int().nonnegative(),
  exp: z.number().int(),
});
type SessionPayload = z.infer<typeof SessionPayloadSchema>;

export function createSessionToken(
  userId: string,
  sessionVersion: number,
  secret: string,
  now = Date.now()
): string {
  const payload: SessionPayload = {
    iss: "change-detective",
    sub: userId,
    sv: sessionVersion,
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
  secret: string,
  now = Date.now()
): SessionPayload | null {
  if (!token || token.length > 2048) return null;
  const [encodedPayload, signature, ...rest] = token.split(".");
  if (!encodedPayload || !signature || rest.length !== 0) return null;

  const expectedSignature = Buffer.from(
    createHmac("sha256", secret)
      .update(encodedPayload)
      .digest("base64url")
  );
  const suppliedSignature = Buffer.from(signature);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    );
  } catch {
    return null;
  }

  const session = SessionPayloadSchema.safeParse(payload);
  if (!session.success || session.data.exp <= Math.floor(now / 1000)) {
    return null;
  }
  return session.data;
}

export function createSessionGuard(config: AuthConfig): onRequestHookHandler {
  return async (request, reply) => {
    const requestPath = request.url.split("?")[0] ?? "";
    const isAgentRequest = AGENT_PATHS.some((path) => path.test(requestPath));
    const token = getSessionCookie(request.headers.cookie);
    const session = verifySessionToken(token, config.secret);
    if (session) {
      const user = await prisma.user.findUnique({
        where: { id: session.sub },
        select: { id: true, email: true, sessionVersion: true, emailVerifiedAt: true },
      });
      if (user?.emailVerifiedAt && user.sessionVersion === session.sv) {
        request.authUserId = user.id;
        request.authEmail = user.email;
      }
    }

    if (
      PUBLIC_PATHS.has(requestPath) ||
      isAgentRequest
    ) {
      return;
    }
    if (!request.authUserId) {
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

export function createGoogleStateCookie(state: string, secure: boolean): string {
  return `${GOOGLE_STATE_COOKIE_NAME}=${state}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=600${secure ? "; Secure" : ""}`;
}

export function clearGoogleStateCookie(secure: boolean): string {
  return `${GOOGLE_STATE_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/api; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? "; Secure" : ""}`;
}
