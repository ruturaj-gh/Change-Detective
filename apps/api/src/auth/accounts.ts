import { homedir } from "node:os";
import { prisma } from "../db/client.js";

export const LEGACY_USER_ID = "00000000-0000-4000-8000-000000000001";
export const PRIVACY_NOTICE_VERSION = "2026-11-17";

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function claimLegacyData(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.user.updateMany({
      where: { id: LEGACY_USER_ID, isLegacy: true },
      data: { isLegacy: false },
    });
    if (claimed.count === 0) return;

    await tx.device.updateMany({
      where: { userId: LEGACY_USER_ID },
      data: { userId },
    });
    await tx.agentEnrollment.updateMany({
      where: { userId: LEGACY_USER_ID },
      data: { userId },
    });

    const legacySettings = await tx.settings.findUnique({
      where: { userId: LEGACY_USER_ID },
      select: { id: true },
    });
    if (legacySettings) {
      const currentSettings = await tx.settings.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (currentSettings) {
        await tx.settings.delete({ where: { userId: LEGACY_USER_ID } });
      } else {
        await tx.settings.update({
          where: { userId: LEGACY_USER_ID },
          data: { userId },
        });
      }
    }

    await tx.user.delete({ where: { id: LEGACY_USER_ID } });
  });
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
    const account = await prisma.user.update({
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
    if (bootstrapEmail === normalized) {
      await claimLegacyData(account.id);
    }
    return account;
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
    const account = await prisma.user.update({
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
    if (bootstrapEmail === normalized) {
      await claimLegacyData(account.id);
    }
    return account;
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
