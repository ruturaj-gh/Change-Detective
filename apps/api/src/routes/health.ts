/**
 * GET /api/health
 * Reports API and database availability separately.
 */
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../db/client.js";

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health", async (_req, reply) => {
    let dbStatus: "ok" | "error" = "ok";
    let dbError: string | null = null;

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      dbStatus = "error";
      dbError = err instanceof Error ? err.message : "Unknown database error.";
    }

    const status = dbStatus === "ok" ? 200 : 503;
    return reply.status(status).send({
      api: "ok",
      database: dbStatus,
      ...(dbError && { databaseError: dbError }),
      timestamp: new Date().toISOString(),
    });
  });
};
