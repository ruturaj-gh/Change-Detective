/**
 * Devices route.
 * GET /api/devices — list local devices (single device in MVP)
 */
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../db/client.js";
import { getOrCreateDeviceId } from "../config/device-id.js";

export const deviceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/devices", async (_req, reply) => {
    const agentMode = process.env["SCAN_MODE"] === "agent";
    const devices = agentMode
      ? (await prisma.device.findMany({
          where: { agentTokenHash: { not: null } },
          select: {
            id: true,
            name: true,
            osName: true,
            monitoredRoot: true,
            createdAt: true,
            lastSeenAt: true,
          },
        })).map((device) => ({ ...device, isAgent: true }))
      : (await prisma.device.findMany({
          where: { id: await getOrCreateDeviceId() },
          select: {
            id: true,
            name: true,
            osName: true,
            createdAt: true,
            lastSeenAt: true,
          },
        })).map((device) => ({ ...device, isAgent: false }));
    return reply.send({ devices });
  });
};
