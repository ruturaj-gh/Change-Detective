import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  approveAgentPairing,
  createAgentEnrollment,
  getAgentPairingRequest,
  InvalidAgentPairingError,
  revokeAgent,
} from "../services/agent.service.js";
import { getSessionUserId } from "./session-user.js";

export const agentsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { id: string } }>(
    "/agents/pairings/:id",
    async (request, reply) => {
      const userId = getSessionUserId(request, reply);
      if (!userId) return;
      const pairingId = z.string().uuid().safeParse(request.params.id);
      if (!pairingId.success) {
        return reply.status(400).send({ error: "INVALID_AGENT_PAIRING" });
      }
      const pairing = await getAgentPairingRequest(pairingId.data);
      return reply.send({ pairing });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    "/agents/pairings/:id/approve",
    async (request, reply) => {
      const userId = getSessionUserId(request, reply);
      if (!userId) return;
      const pairingId = z.string().uuid().safeParse(request.params.id);
      if (!pairingId.success) {
        return reply.status(400).send({ error: "INVALID_AGENT_PAIRING" });
      }
      try {
        const approved = await approveAgentPairing(userId, pairingId.data);
        if (!approved) {
          return reply.status(409).send({
            error: "PAIRING_UNAVAILABLE",
            message: "This pairing request expired or has already been approved.",
          });
        }
        return reply.send({ approved: true });
      } catch (error) {
        if (error instanceof InvalidAgentPairingError) {
          return reply.status(400).send({
            error: "INVALID_AGENT_PAIRING",
            message: error.message,
          });
        }
        throw error;
      }
    }
  );

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
