/**
 * Findings routes.
 * GET /api/findings — list findings for the local device
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { listFindings } from "../services/findings.service.js";
import { getSessionUserId } from "./session-user.js";

const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const findingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/findings", async (req, reply) => {
    const userId = getSessionUserId(req, reply);
    if (!userId) return;
    const query = PaginationSchema.safeParse(req.query);
    if (!query.success) {
      return reply.status(400).send({ error: "INVALID_QUERY", details: query.error.flatten() });
    }
    const findings = await listFindings(
      userId,
      query.data.limit,
      query.data.offset
    );
    return reply.send({ findings });
  });
};
