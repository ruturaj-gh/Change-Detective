import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_SECONDS,
  createSessionToken,
  verifySessionToken,
} from "../src/auth/session.js";

const secret = "test-secret-with-at-least-thirty-two-bytes";
const userId = "00000000-0000-4000-8000-000000000002";

describe("signed sessions", () => {
  it("accepts a valid session and rejects expired or modified tokens", () => {
    const now = 1_800_000_000_000;
    const token = createSessionToken(userId, 3, secret, now);

    expect(verifySessionToken(token, secret, now)).toMatchObject({
      sub: userId,
      sv: 3,
    });
    expect(
      verifySessionToken(
        token,
        secret,
        now + (SESSION_TTL_SECONDS + 1) * 1000
      )
    ).toBeNull();

    const [payload, signature] = token.split(".");
    expect(
      verifySessionToken(`${payload}.x${signature}`, secret, now)
    ).toBeNull();
  });

  it("rejects malformed or expired session tokens", () => {
    const token = createSessionToken(userId, 0, secret);
    expect(verifySessionToken(token, "another-secret-that-is-different")).toBeNull();
    expect(verifySessionToken(undefined, secret)).toBeNull();
  });
});
