import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSessionGuard,
  type AuthConfig,
  GOOGLE_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "../src/auth/session.js";
import { authRoutes } from "../src/routes/auth.js";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  generateAuthUrl: vi.fn(),
  getToken: vi.fn(),
  verifyIdToken: vi.fn(),
  signInWithGoogle: vi.fn(),
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    generateAuthUrl(options: unknown) {
      return mocks.generateAuthUrl(options);
    }

    getToken(code: string) {
      return mocks.getToken(code);
    }

    verifyIdToken(options: unknown) {
      return mocks.verifyIdToken(options);
    }
  },
}));

vi.mock("../src/db/client.js", () => ({
  prisma: { user: { findUnique: mocks.findUser } },
}));

vi.mock("../src/auth/accounts.js", () => ({
  signInWithGoogle: mocks.signInWithGoogle,
}));

const userId = "00000000-0000-4000-8000-000000000002";
const config: AuthConfig = {
  secret: "test-secret-with-at-least-thirty-two-bytes",
  publicAppUrl: "http://localhost:3000",
  googleClientId: "google-client-id",
  googleClientSecret: "google-client-secret",
};

function cookieValue(cookie: string | string[] | undefined, name: string) {
  const cookies = Array.isArray(cookie) ? cookie : [cookie ?? ""];
  return cookies
    .find((value) => value.startsWith(`${name}=`))
    ?.split(";")[0]
    ?.slice(name.length + 1);
}

describe("Google authentication routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.generateAuthUrl.mockReturnValue("https://accounts.google.test/auth");
    mocks.getToken.mockResolvedValue({
      tokens: { id_token: "google-id-token" },
    });
    mocks.verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: "google-subject",
        email: "owner@example.com",
        email_verified: true,
      }),
    });
    mocks.signInWithGoogle.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      sessionVersion: 0,
    });
    mocks.findUser.mockResolvedValue({
      id: userId,
      email: "owner@example.com",
      sessionVersion: 0,
      emailVerifiedAt: new Date(),
    });
    app = Fastify();
    app.decorateRequest("authUserId", null);
    app.decorateRequest("authEmail", null);
    await app.register(rateLimit, { global: false });
    await app.register(authRoutes, { prefix: "/api", authConfig: config });
    app.addHook("onRequest", createSessionGuard(config));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("requires privacy acceptance before redirecting to Google", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/google",
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(
      "http://localhost:3000/login?error=privacy_required"
    );
    expect(mocks.generateAuthUrl).not.toHaveBeenCalled();
  });

  it("starts OAuth with a random state cookie and Google consent", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/google?acceptPrivacy=true",
    });
    const state = cookieValue(
      response.headers["set-cookie"],
      GOOGLE_STATE_COOKIE_NAME
    );

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://accounts.google.test/auth");
    expect(state).toBeTruthy();
    expect(mocks.generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        state,
        scope: ["openid", "email", "profile"],
        prompt: "select_account",
      })
    );
  });

  it("validates the Google identity, creates a session, and redirects home", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/auth/google?acceptPrivacy=true",
    });
    const state = cookieValue(
      response.headers["set-cookie"],
      GOOGLE_STATE_COOKIE_NAME
    );
    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=oauth-code&state=${state}`,
      headers: {
        cookie: `${GOOGLE_STATE_COOKIE_NAME}=${state}`,
      },
    });

    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe("http://localhost:3000/");
    expect(cookieValue(callback.headers["set-cookie"], SESSION_COOKIE_NAME)).toBeTruthy();
    expect(mocks.getToken).toHaveBeenCalledWith("oauth-code");
    expect(mocks.verifyIdToken).toHaveBeenCalledWith({
      idToken: "google-id-token",
      audience: config.googleClientId,
    });
    expect(mocks.signInWithGoogle).toHaveBeenCalledWith(
      "google-subject",
      "owner@example.com",
      undefined
    );
  });

  it("rejects callbacks with an invalid OAuth state", async () => {
    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=oauth-code&state=${"a".repeat(32)}`,
      headers: {
        cookie: `${GOOGLE_STATE_COOKIE_NAME}=${"b".repeat(32)}`,
      },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(
      "http://localhost:3000/login?error=google_auth_failed"
    );
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("does not sign in with a Google account that has no verified email", async () => {
    mocks.verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: "google-subject",
        email: "owner@example.com",
        email_verified: false,
      }),
    });
    const start = await app.inject({
      method: "GET",
      url: "/api/auth/google?acceptPrivacy=true",
    });
    const state = cookieValue(
      start.headers["set-cookie"],
      GOOGLE_STATE_COOKIE_NAME
    );
    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=oauth-code&state=${state}`,
      headers: {
        cookie: `${GOOGLE_STATE_COOKIE_NAME}=${state}`,
      },
    });

    expect(callback.headers.location).toBe(
      "http://localhost:3000/login?error=google_auth_failed"
    );
    expect(mocks.signInWithGoogle).not.toHaveBeenCalled();
  });

  it("accepts valid existing account sessions on private API routes", async () => {
    const protectedApp = Fastify();
    protectedApp.decorateRequest("authUserId", null);
    protectedApp.decorateRequest("authEmail", null);
    protectedApp.addHook("onRequest", createSessionGuard(config));
    protectedApp.get("/api/private", async (request) => ({
      userId: request.authUserId,
    }));
    await protectedApp.ready();

    const anonymous = await protectedApp.inject({
      method: "GET",
      url: "/api/private",
    });
    expect(anonymous.statusCode).toBe(401);

    await protectedApp.close();
  });
});
