/**
 * Devices route.
 * GET /api/devices — list local devices (single device in MVP)
 */
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../db/client.js";
import { getOrCreateDeviceId } from "../config/device-id.js";

export const deviceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/devices", async (_req, reply) => {
    const deviceId = await getOrCreateDeviceId();
    const devices = await prisma.device.findMany({
      where: { id: deviceId },
    });
    return reply.send({ devices });
  });
};
