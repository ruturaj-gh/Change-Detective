import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  createAgentEnrollment,
  revokeAgent,
} from "../services/agent.service.js";
import { getSessionUserId } from "./session-user.js";

export const agentsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/agents/enrollment", {
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
      const enrollment = await createAgentEnrollment(userId);
      return reply.status(201).send({
        enrollmentToken: enrollment.token,
        expiresAt: enrollment.expiresAt.toISOString(),
      });
    },
  });

  fastify.delete<{ Params: { id: string } }>(
    "/agents/:id",
    async (request, reply) => {
      const userId = getSessionUserId(request, reply);
      if (!userId) return;
      const deviceId = z.string().uuid().safeParse(request.params.id);
      if (!deviceId.success) {
        return reply.status(400).send({ error: "INVALID_AGENT_ID" });
      }
      const revoked = await revokeAgent(userId, deviceId.data);
      if (!revoked) {
        return reply.status(404).send({ error: "AGENT_NOT_FOUND" });
      }
      return reply.send({ revoked: true });
    }
  );
};
