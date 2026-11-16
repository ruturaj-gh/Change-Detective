import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/credentials.js";
import {
  SESSION_TTL_SECONDS,
  createSessionToken,
  verifySessionToken,
  type AuthConfig,
} from "../src/auth/session.js";

const authConfig: AuthConfig = {
  email: "owner@example.com",
  passwordHash: "",
  secret: "test-secret-with-at-least-thirty-two-bytes",
};

describe("password credentials", () => {
  it("verifies the password and rejects a different one", async () => {
    const encoded = await hashPassword("a sufficiently long password");

    expect(await verifyPassword("a sufficiently long password", encoded)).toBe(
      true
    );
    expect(await verifyPassword("another password", encoded)).toBe(false);
  });
});

describe("signed sessions", () => {
  it("accepts a valid session and rejects expired or modified tokens", () => {
    const now = 1_800_000_000_000;
    const token = createSessionToken(authConfig.email, authConfig.secret, now);

    expect(verifySessionToken(token, authConfig, now)).toBe(true);
    expect(
      verifySessionToken(
        token,
        authConfig,
        now + (SESSION_TTL_SECONDS + 1) * 1000
      )
    ).toBe(false);

    const [payload, signature] = token.split(".");
    expect(
      verifySessionToken(`${payload}.x${signature}`, authConfig, now)
    ).toBe(false);
  });

  it("rejects a valid token issued for another account", () => {
    const token = createSessionToken("someone-else@example.com", authConfig.secret);
    expect(verifySessionToken(token, authConfig)).toBe(false);
  });
});
