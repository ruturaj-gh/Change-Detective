/**
 * GET /api/health
 * Reports API and database availability separately.
 */
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../db/client.js";

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health", async (_req, reply) => {
    let dbStatus: "ok" | "error" = "ok";

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      dbStatus = "error";
      fastify.log.warn({ err }, "Database health check failed");
    }

    const status = dbStatus === "ok" ? 200 : 503;
    return reply.status(status).send({
      api: "ok",
      database: dbStatus,
      timestamp: new Date().toISOString(),
    });
  });
};
