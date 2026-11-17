import { homedir } from "node:os";
import { prisma } from "../db/client.js";

export const LEGACY_USER_ID = "00000000-0000-4000-8000-000000000001";
export const PRIVACY_NOTICE_VERSION = "2026-11-17";

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function signInWithGoogle(
  googleSubject: string,
  email: string,
  bootstrapEmail?: string
) {
  const normalized = normalizedEmail(email);
  const privacyAcceptedAt = new Date();
  const privacy = {
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    privacyAcceptedAt,
  };
  const existingBySubject = await prisma.user.findUnique({
    where: { googleSubject },
  });
  if (existingBySubject) {
    return prisma.user.update({
      where: { id: existingBySubject.id },
      data: {
        email: normalized,
        emailVerifiedAt: privacyAcceptedAt,
        ...(existingBySubject.privacyNoticeVersion === PRIVACY_NOTICE_VERSION &&
        existingBySubject.privacyAcceptedAt
          ? {}
          : privacy),
      },
      select: { id: true, email: true, sessionVersion: true },
    });
  }

  const existingByEmail = await prisma.user.findUnique({
    where: { email: normalized },
  });
  if (existingByEmail) {
    if (
      existingByEmail.googleSubject &&
      existingByEmail.googleSubject !== googleSubject
    ) {
      throw new Error("This email is already linked to another Google account.");
    }
    return prisma.user.update({
      where: { id: existingByEmail.id },
      data: {
        googleSubject,
        emailVerifiedAt: privacyAcceptedAt,
        isLegacy: false,
        ...(existingByEmail.privacyNoticeVersion === PRIVACY_NOTICE_VERSION &&
        existingByEmail.privacyAcceptedAt
          ? {}
          : privacy),
      },
      select: { id: true, email: true, sessionVersion: true },
    });
  }

  if (bootstrapEmail === normalized) {
    const legacy = await prisma.user.findUnique({
      where: { id: LEGACY_USER_ID },
      select: { isLegacy: true },
    });
    if (legacy?.isLegacy) {
      return prisma.user.update({
        where: { id: LEGACY_USER_ID },
        data: {
          email: normalized,
          googleSubject,
          emailVerifiedAt: privacyAcceptedAt,
          isLegacy: false,
          ...privacy,
        },
        select: { id: true, email: true, sessionVersion: true },
      });
    }
  }

  return prisma.user.create({
    data: {
      email: normalized,
      googleSubject,
      emailVerifiedAt: privacyAcceptedAt,
      ...privacy,
      settings: {
        create: {
          monitoredRoot: process.platform === "win32" ? "C:\\" : homedir(),
        },
      },
    },
    select: { id: true, email: true, sessionVersion: true },
  });
}

export async function deleteAccount(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } });
}
