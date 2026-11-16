import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  AgentAlreadyEnrolledError,
  createAgentEnrollment,
  revokeAgent,
} from "../services/agent.service.js";

export const agentsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/agents/enrollment", {
    config: { rateLimit: { max: 5, timeWindow: 15 * 60 * 1000 } },
    handler: async (_request, reply) => {
      try {
        const enrollment = await createAgentEnrollment();
        return reply.status(201).send({
          enrollmentToken: enrollment.token,
          expiresAt: enrollment.expiresAt.toISOString(),
        });
      } catch (error) {
        if (error instanceof AgentAlreadyEnrolledError) {
          return reply.status(409).send({
            error: "AGENT_ALREADY_ENROLLED",
            message: error.message,
          });
        }
        throw error;
      }
    },
  });

  fastify.delete<{ Params: { id: string } }>(
    "/agents/:id",
    async (request, reply) => {
      const deviceId = z.string().uuid().safeParse(request.params.id);
      if (!deviceId.success) {
        return reply.status(400).send({ error: "INVALID_AGENT_ID" });
      }
      const revoked = await revokeAgent(deviceId.data);
      if (!revoked) {
        return reply.status(404).send({ error: "AGENT_NOT_FOUND" });
      }
      return reply.send({ revoked: true });
    }
  );
};
