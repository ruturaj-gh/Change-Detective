/**
 * Devices route.
 * GET /api/devices — list devices owned by the signed-in account
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import {
  InvalidAgentRootError,
  updateAgentMonitoredRoot,
} from "../services/agent.service.js";
import { getSessionUserId } from "./session-user.js";

export const deviceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/devices", async (req, reply) => {
    const userId = getSessionUserId(req, reply);
    if (!userId) return;
    const devices = (await prisma.device.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        osName: true,
        monitoredRoot: true,
        createdAt: true,
        lastSeenAt: true,
        agentTokenHash: true,
      },
    })).map(({ agentTokenHash, ...device }) => ({
      ...device,
      isAgent: agentTokenHash !== null,
    }));
    return reply.send({
      devices,
      scanMode: process.env["SCAN_MODE"] === "agent" ? "agent" : "local",
    });
  });

  fastify.patch<{ Params: { id: string } }>(
    "/devices/:id/root",
    async (req, reply) => {
      const userId = getSessionUserId(req, reply);
      if (!userId) return;
      const id = z.string().uuid().safeParse(req.params.id);
      const body = z
        .object({ monitoredRoot: z.string().trim().min(1).max(4096) })
        .safeParse(req.body);
      if (!id.success || !body.success) {
        return reply.status(400).send({ error: "INVALID_DEVICE_ROOT" });
      }
      try {
        const updated = await updateAgentMonitoredRoot(
          userId,
          id.data,
          body.data.monitoredRoot
        );
        if (!updated) return reply.status(404).send({ error: "DEVICE_NOT_FOUND" });
        return reply.send({ updated: true });
      } catch (error) {
        if (error instanceof InvalidAgentRootError) {
          return reply.status(400).send({
            error: "INVALID_DEVICE_ROOT",
            message: error.message,
          });
        }
        throw error;
      }
    }
  );
};
