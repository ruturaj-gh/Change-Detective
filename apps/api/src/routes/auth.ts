import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { signInWithGoogle } from "../auth/accounts.js";
import {
  clearGoogleStateCookie,
  clearSessionCookie,
  createGoogleStateCookie,
  createSessionCookie,
  createSessionToken,
  GOOGLE_STATE_COOKIE_NAME,
  type AuthConfig,
  readGoogleStateCookie,
} from "../auth/session.js";

interface AuthRouteOptions {
  authConfig: AuthConfig;
}

const GoogleStartQuery = z.object({
  acceptPrivacy: z.literal("true"),
  next: z.string().max(2048).optional(),
});
const GoogleCallbackQuery = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(32).max(128).optional(),
  error: z.string().optional(),
});

function googleClient(config: AuthConfig): OAuth2Client | null {
  if (!config.googleClientId || !config.googleClientSecret) return null;
  const callbackUrl = new URL(
    "/api/auth/google/callback",
    config.publicAppUrl
  ).toString();
  return new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret,
    callbackUrl
  );
}

function getCookie(
  cookieHeader: string | undefined,
  name: string
): string | undefined {
  if (!cookieHeader) return undefined;
  const prefix = `${name}=`;
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function safeReturnPath(value: string | undefined): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/";
  }
  try {
    return new URL(value, "https://change-detective.invalid").origin ===
      "https://change-detective.invalid"
      ? value
      : "/";
  } catch {
    return "/";
  }
}

function loginErrorUrl(config: AuthConfig, error: string): string {
  const url = new URL("/login", config.publicAppUrl);
  url.searchParams.set("error", error);
  return url.toString();
}

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (
  fastify,
  { authConfig }
) => {
  fastify.get("/auth/google", async (request, reply) => {
    const query = GoogleStartQuery.safeParse(request.query);
    if (!query.success) {
      return reply.redirect(loginErrorUrl(authConfig, "privacy_required"));
    }

    const client = googleClient(authConfig);
    if (!client) {
      return reply.redirect(loginErrorUrl(authConfig, "google_not_configured"));
    }

    const state = randomBytes(32).toString("base64url");
    const secure = process.env["NODE_ENV"] === "production";
    return reply
      .header(
        "Set-Cookie",
        createGoogleStateCookie(state, secure, safeReturnPath(query.data.next))
      )
      .redirect(
        client.generateAuthUrl({
          access_type: "online",
          prompt: "select_account",
          scope: ["openid", "email", "profile"],
          state,
        })
      );
  });

  fastify.get("/auth/google/callback", {
    logLevel: "silent",
    handler: async (request, reply) => {
      const query = GoogleCallbackQuery.safeParse(request.query);
      const secure = process.env["NODE_ENV"] === "production";
      const stateCookie = getCookie(
        request.headers.cookie,
        GOOGLE_STATE_COOKIE_NAME
      );
      const stateData = readGoogleStateCookie(stateCookie);
      const stateMatches =
        query.success &&
        query.data.state &&
        stateData &&
        safeEqual(query.data.state, stateData.state);
      const clearState = clearGoogleStateCookie(secure);

      if (
        !query.success ||
        query.data.error ||
        !query.data.code ||
        !stateMatches
      ) {
        return reply
          .header("Set-Cookie", clearState)
          .redirect(loginErrorUrl(authConfig, "google_auth_failed"));
      }

      const client = googleClient(authConfig);
      if (!client) {
        return reply
          .header("Set-Cookie", clearState)
          .redirect(loginErrorUrl(authConfig, "google_not_configured"));
      }

      try {
        const { tokens } = await client.getToken(query.data.code);
        if (!tokens.id_token || !authConfig.googleClientId) {
          throw new Error("Google did not return a valid identity token.");
        }
        const ticket = await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: authConfig.googleClientId,
        });
        const identity = ticket.getPayload();
        if (
          !identity?.sub ||
          !identity.email ||
          identity.email_verified !== true
        ) {
          throw new Error("Google account has no verified email identity.");
        }
        const account = await signInWithGoogle(
          identity.sub,
          identity.email,
          authConfig.bootstrapEmail
        );
        const sessionToken = createSessionToken(
          account.id,
          account.sessionVersion,
          authConfig.secret
        );
        const sessionCookie = createSessionCookie(sessionToken, secure);
        return reply
          .header("Set-Cookie", [clearState, sessionCookie])
          .redirect(
            new URL(stateData.returnTo, authConfig.publicAppUrl).toString(),
            303
          );
      } catch (error) {
        fastify.log.error(
          { errorType: error instanceof Error ? error.name : "UnknownError" },
          "Google sign-in failed"
        );
        return reply
          .header("Set-Cookie", clearState)
          .redirect(loginErrorUrl(authConfig, "google_auth_failed"));
      }
    },
  });

  fastify.get("/auth/session", async (request, reply) => {
    if (!request.authUserId || !request.authEmail) {
      return reply.status(401).send({ authenticated: false });
    }
    return reply.send({
      authenticated: true,
      authenticationEnabled: true,
      user: { id: request.authUserId, email: request.authEmail },
    });
  });

  fastify.post("/auth/logout", async (_request, reply) => {
    const secure = process.env["NODE_ENV"] === "production";
    return reply
      .header("Set-Cookie", clearSessionCookie(secure))
      .send({ authenticated: false });
  });
};
