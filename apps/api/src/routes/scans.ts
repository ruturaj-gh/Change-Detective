/**
 * Scan routes.
 * POST /api/scans    — start a manual scan (async, returns 202)
 * GET  /api/scans    — list recent scans
 * GET  /api/scans/:id           — get scan status
 * GET  /api/scans/:id/directories — directory snapshots
 * GET  /api/scans/:id/changes   — delta vs previous scan; optional previousScanId selects a baseline
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  startScan,
  getScanById,
  listScans,
  getScanDirectories,
  getScanChanges,
  InvalidScanComparisonError,
  NoEnrolledAgentError,
} from "../services/scan.service.js";
import { getSessionUserId } from "./session-user.js";

const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const ComparisonQuerySchema = z.object({
  previousScanId: z.string().uuid().optional(),
});
const StartScanSchema = z
  .object({ deviceId: z.string().uuid().optional() })
  .optional();

export const scanRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/scans
  fastify.post("/scans", async (req, reply) => {
    const userId = getSessionUserId(req, reply);
    if (!userId) return;
    const body = StartScanSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: "INVALID_SCAN_REQUEST" });
    }

    let result;
    try {
      result = await startScan(userId, "manual", body.data?.deviceId);
    } catch (error) {
      if (error instanceof NoEnrolledAgentError) {
        return reply.status(503).send({
          error: "NO_ENROLLED_AGENT",
          message: error.message,
        });
      }
      throw error;
    }

    if (result.status === "already_running") {
      return reply.status(409).send({
        error: "SCAN_ALREADY_RUNNING",
        message: "A scan is already running for this root. Wait for it to finish.",
        scanId: result.existingScanId,
      });
    }

    return reply.status(202).send({
      scanId: result.scanId,
      status: result.status,
    });
  });

  // GET /api/scans
  fastify.get("/scans", async (req, reply) => {
    const userId = getSessionUserId(req, reply);
    if (!userId) return;
    const query = PaginationSchema.safeParse(req.query);
    if (!query.success) {
      return reply.status(400).send({ error: "INVALID_QUERY", details: query.error.flatten() });
    }
    const scans = await listScans(
      userId,
      query.data.limit,
      query.data.offset
    );
    return reply.send({ scans });
  });

  // GET /api/scans/:id
  fastify.get<{ Params: { id: string } }>("/scans/:id", async (req, reply) => {
    const userId = getSessionUserId(req, reply);
    if (!userId) return;
    const scan = await getScanById(req.params.id, userId);
    if (!scan) {
      return reply.status(404).send({ error: "NOT_FOUND", message: "Scan not found." });
    }
    return reply.send({ scan });
  });

  // GET /api/scans/:id/directories
  fastify.get<{ Params: { id: string } }>(
    "/scans/:id/directories",
    async (req, reply) => {
      const userId = getSessionUserId(req, reply);
      if (!userId) return;
      const scan = await getScanById(req.params.id, userId);
      if (!scan) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Scan not found." });
      }
      const directories = await getScanDirectories(req.params.id, userId);
      return reply.send({ directories });
    }
  );

  // GET /api/scans/:id/changes
  fastify.get<{ Params: { id: string } }>(
    "/scans/:id/changes",
    async (req, reply) => {
      const userId = getSessionUserId(req, reply);
      if (!userId) return;
      const query = ComparisonQuerySchema.safeParse(req.query);
      if (!query.success) {
        return reply.status(400).send({ error: "INVALID_QUERY", details: query.error.flatten() });
      }

      let result;
      try {
        result = await getScanChanges(
          req.params.id,
          userId,
          query.data.previousScanId
        );
      } catch (err) {
        if (err instanceof InvalidScanComparisonError) {
          return reply.status(422).send({ error: "INCOMPARABLE_SCANS", message: err.message });
        }
        throw err;
      }
      if (!result) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Scan not found." });
      }
      return reply.send(result);
    }
  );
};
