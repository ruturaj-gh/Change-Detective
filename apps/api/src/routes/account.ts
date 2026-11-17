import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { deleteAccount } from "../auth/accounts.js";
import { clearSessionCookie } from "../auth/session.js";
import { prisma } from "../db/client.js";
import { getSessionUserId } from "./session-user.js";

export const accountRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/account", async (request, reply) => {
    const userId = getSessionUserId(request, reply);
    if (!userId) return;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        privacyNoticeVersion: true,
        privacyAcceptedAt: true,
        createdAt: true,
        _count: { select: { devices: true } },
        devices: {
          select: {
            _count: { select: { scans: true } },
          },
        },
      },
    });
    if (!user) return reply.status(404).send({ error: "ACCOUNT_NOT_FOUND" });
    const scanCount = user.devices.reduce(
      (total, device) => total + device._count.scans,
      0
    );
    return reply.send({
      account: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        createdAt: user.createdAt,
        deviceCount: user._count.devices,
        scanCount,
      },
    });
  });

  fastify.delete("/account", {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: 15 * 60 * 1000,
        keyGenerator: (request) => request.authUserId ?? request.ip,
      },
    },
    handler: async (request, reply) => {
      const userId = getSessionUserId(request, reply);
      if (!userId) return;
      const body = z
        .object({
          confirmation: z.literal("DELETE"),
        })
        .safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: "ACCOUNT_DELETE_CONFIRMATION_REQUIRED" });
      }
      await deleteAccount(userId);
      const secure = process.env["NODE_ENV"] === "production";
      return reply
        .header("Set-Cookie", clearSessionCookie(secure))
        .send({ deleted: true });
    },
  });
};
