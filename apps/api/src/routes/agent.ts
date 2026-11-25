import type {
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import { z } from "zod";
import {
  authenticateAgentToken,
  claimNextAgentTask,
  enrollAgent,
  getAgentScanIntervalMinutes,
  InvalidAgentScanResultError,
  InvalidEnrollmentTokenError,
  renewAgentTaskLease,
  saveAgentLocalScanResult,
  saveAgentScanResult,
} from "../services/agent.service.js";
import { AgentScanResultSchema } from "../schemas/agent.js";
import { AgentEnrollmentSchema } from "../schemas/agent-enrollment.js";

function bearerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  return match?.[1] ?? null;
}

async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const token = bearerToken(request);
  if (!token) {
    reply.status(401).send({ error: "UNAUTHENTICATED_AGENT" });
    return null;
  }
  const device = await authenticateAgentToken(token);
  if (!device) {
    reply.status(401).send({ error: "UNAUTHENTICATED_AGENT" });
    return null;
  }
  return device;
}

export const agentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/agent/enroll", async (request, reply) => {
    const input = AgentEnrollmentSchema.safeParse(request.body);
    if (!input.success) {
      return reply.status(400).send({
        error: "INVALID_ENROLLMENT",
        details: input.error.flatten(),
      });
    }

    try {
      const enrolled = await enrollAgent({
        token: input.data.enrollmentToken,
        name: input.data.name,
        osName: input.data.osName,
        monitoredRoot: input.data.monitoredRoot,
      });
      return reply.status(201).send(enrolled);
    } catch (error) {
      if (error instanceof InvalidEnrollmentTokenError) {
        return reply.status(401).send({ error: "INVALID_ENROLLMENT_TOKEN" });
      }
      throw error;
    }
  });

  fastify.get("/agent/tasks/next", async (request, reply) => {
    const device = await authenticate(request, reply);
    if (!device) return;

    const scanIntervalMinutes = await getAgentScanIntervalMinutes(device.id);
    const task = await claimNextAgentTask(device.id);
    return reply.send({
      scanIntervalMinutes,
      task: task
        ? {
            scanId: task.id,
            rootPath: task.rootPath,
            triggerType: task.triggerType,
          }
        : null,
      pollAfterSeconds: 30,
    });
  });

  fastify.post<{ Params: { scanId: string } }>(
    "/agent/scans/local/:scanId/results",
    async (request, reply) => {
      const device = await authenticate(request, reply);
      if (!device) return;

      const scanId = z.string().uuid().safeParse(request.params.scanId);
      const submission = z
        .object({
          triggerType: z.enum(["scheduled", "event"]),
          result: AgentScanResultSchema,
        })
        .safeParse(request.body);
      if (!scanId.success || !submission.success) {
        return reply.status(400).send({ error: "INVALID_SCAN_RESULT" });
      }

      try {
        await saveAgentLocalScanResult(
          device.id,
          scanId.data,
          submission.data.triggerType,
          submission.data.result
        );
      } catch (error) {
        if (error instanceof InvalidAgentScanResultError) {
          return reply.status(409).send({ error: "SCAN_RESULT_REJECTED" });
        }
        throw error;
      }
      return reply.status(202).send({ accepted: true });
    }
  );

  fastify.post<{ Params: { scanId: string } }>(
    "/agent/scans/:scanId/heartbeat",
    async (request, reply) => {
      const device = await authenticate(request, reply);
      if (!device) return;

      const scanId = z.string().uuid().safeParse(request.params.scanId);
      if (!scanId.success) {
        return reply.status(400).send({ error: "INVALID_SCAN_ID" });
      }

      const renewed = await renewAgentTaskLease(device.id, scanId.data);
      if (!renewed) {
        return reply.status(409).send({ error: "SCAN_NOT_ACTIVE" });
      }
      return reply.send({ renewed: true });
    }
  );

  fastify.post<{ Params: { scanId: string } }>(
    "/agent/scans/:scanId/results",
    async (request, reply) => {
      const device = await authenticate(request, reply);
      if (!device) return;

      const scanId = z.string().uuid().safeParse(request.params.scanId);
      const result = AgentScanResultSchema.safeParse(request.body);
      if (!scanId.success || !result.success) {
        return reply.status(400).send({ error: "INVALID_SCAN_RESULT" });
      }

      try {
        await saveAgentScanResult(device.id, scanId.data, result.data);
      } catch (error) {
        if (error instanceof InvalidAgentScanResultError) {
          return reply.status(409).send({ error: "SCAN_RESULT_REJECTED" });
        }
        throw error;
      }
      return reply.status(202).send({ accepted: true });
    }
  );
};

