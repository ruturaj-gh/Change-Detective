import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/credentials.js";
import {
  createSessionGuard,
  createSessionToken,
  type AuthConfig,
} from "../src/auth/session.js";
import { authRoutes } from "../src/routes/auth.js";

describe("authentication routes", () => {
  let app: ReturnType<typeof Fastify>;
  let config: AuthConfig;

  beforeEach(async () => {
    config = {
      email: "owner@example.com",
      passwordHash: await hashPassword("a sufficiently long password"),
      secret: "test-secret-with-at-least-thirty-two-bytes",
    };
    app = Fastify();
    await app.register(rateLimit, { global: false });
    await app.register(authRoutes, { prefix: "/api", authConfig: config });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("sets an HttpOnly session cookie and accepts it on the session endpoint", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: config.email,
        password: "a sufficiently long password",
      },
    });

    expect(login.statusCode).toBe(200);
    const setCookie = login.headers["set-cookie"];
    const cookieHeader = (
      typeof setCookie === "string" ? setCookie : setCookie?.[0]
    )?.split(";")[0];
    expect(cookieHeader).toMatch(/^change_detective_session=/);
    expect(setCookie).toContain("HttpOnly");

    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: cookieHeader },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({
      authenticated: true,
      email: config.email,
    });
  });

  it("returns the same generic error for invalid credentials", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@example.com", password: "wrong password" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "INVALID_CREDENTIALS" });
  });

  it("rejects anonymous private API requests and accepts a valid session", async () => {
    const protectedApp = Fastify();
    protectedApp.addHook("onRequest", createSessionGuard(config));
    protectedApp.get("/api/private", async () => ({ ok: true }));
    await protectedApp.ready();

    const anonymous = await protectedApp.inject({
      method: "GET",
      url: "/api/private",
    });
    expect(anonymous.statusCode).toBe(401);

    const token = createSessionToken(config.email, config.secret);
    const authenticated = await protectedApp.inject({
      method: "GET",
      url: "/api/private",
      headers: { cookie: `change_detective_session=${token}` },
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json()).toEqual({ ok: true });

    await protectedApp.close();
  });
});
