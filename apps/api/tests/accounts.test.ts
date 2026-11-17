import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_USER_ID,
  PRIVACY_NOTICE_VERSION,
  signInWithGoogle,
} from "../src/auth/accounts.js";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
}));

vi.mock("../src/db/client.js", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      update: mocks.update,
      create: mocks.create,
    },
  },
}));

describe("Google account linking", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.update.mockResolvedValue({
      id: "account-id",
      email: "person@example.com",
      sessionVersion: 0,
    });
    mocks.create.mockResolvedValue({
      id: "new-account",
      email: "person@example.com",
      sessionVersion: 0,
    });
  });

  it("links an existing account by the verified Google email", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "existing-account",
        googleSubject: null,
      });

    await signInWithGoogle("google-subject", "Person@Example.com");

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-account" },
        data: expect.objectContaining({
          googleSubject: "google-subject",
          emailVerifiedAt: expect.any(Date),
          privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
          isLegacy: false,
        }),
      })
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates a fresh account with default settings on first Google sign-in", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await signInWithGoogle("google-subject", "person@example.com");

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "person@example.com",
          googleSubject: "google-subject",
          emailVerifiedAt: expect.any(Date),
          settings: { create: expect.objectContaining({ monitoredRoot: expect.any(String) }) },
        }),
      })
    );
  });

  it("allows only the configured Google email to claim legacy account data", async () => {
    mocks.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ isLegacy: true });

    await signInWithGoogle(
      "google-subject",
      "owner@example.com",
      "owner@example.com"
    );

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LEGACY_USER_ID },
        data: expect.objectContaining({ googleSubject: "google-subject" }),
      })
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
