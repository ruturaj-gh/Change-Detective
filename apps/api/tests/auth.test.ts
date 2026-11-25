import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadAuthConfig,
  SESSION_TTL_SECONDS,
  createSessionToken,
  verifySessionToken,
} from "../src/auth/session.js";

const secret = "test-secret-with-at-least-thirty-two-bytes";
const userId = "00000000-0000-4000-8000-000000000002";

describe("auth configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the forwarded HTTPS origin in Codespaces when the URL is localhost", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("CODESPACE_NAME", "bright-potato");
    vi.stubEnv(
      "GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN",
      "app.github.dev"
    );
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
    vi.stubEnv("AUTH_SECRET", secret);

    expect(loadAuthConfig().publicAppUrl).toBe(
      "https://bright-potato-3000.app.github.dev"
    );
  });

  it("keeps an explicitly configured public URL in Codespaces", () => {
    vi.stubEnv("PUBLIC_APP_URL", "https://dashboard.example");
    vi.stubEnv("CODESPACE_NAME", "bright-potato");
    vi.stubEnv(
      "GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN",
      "app.github.dev"
    );

    expect(loadAuthConfig().publicAppUrl).toBe("https://dashboard.example");
  });
});

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
