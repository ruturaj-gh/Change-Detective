/**
 * Fastify API server entry point.
 *
 * Binds to 127.0.0.1 (localhost only) by default.
 * Registers all route plugins under the /api prefix.
 * Recovers stale scans on startup.
 * Starts the scheduler.
 */
import dotenv from "dotenv";
// Workspace scripts run with apps/api as the working directory; keep the
// documented root-level .env file as the single source of local config.
dotenv.config({ path: "../../.env" });
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createSessionGuard, loadAuthConfig } from "./auth/session.js";
import { authRoutes } from "./routes/auth.js";
import { accountRoutes } from "./routes/account.js";
import { agentRoutes } from "./routes/agent.js";
import { agentsRoutes } from "./routes/agents.js";
import { healthRoutes } from "./routes/health.js";
import { scanRoutes } from "./routes/scans.js";
import { findingRoutes } from "./routes/findings.js";
import { settingsRoutes } from "./routes/settings.js";
import { deviceRoutes } from "./routes/devices.js";
import { recoverStaleScan } from "./services/scan.service.js";
import { startScheduler, stopScheduler } from "./scheduler/scheduler.js";
import { prisma } from "./db/client.js";

const HOST = process.env["API_HOST"] ?? "127.0.0.1";
const PORT = parseInt(process.env["API_PORT"] ?? "3001", 10);
const authConfig = loadAuthConfig();

const fastify = Fastify({
  bodyLimit: 10 * 1024 * 1024,
  logger: {
    level: process.env["NODE_ENV"] === "production" ? "warn" : "info",
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie"],
      censor: "[REDACTED]",
    },
  },
});

// CORS — allow only localhost origins (the Next.js dev server).
await fastify.register(cors, {
  origin: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    `http://localhost:${PORT}`,
  ],
  methods: ["GET", "POST", "PATCH", "DELETE"],
});

await fastify.register(rateLimit, { global: false });

fastify.decorateRequest("authUserId", null);
fastify.decorateRequest("authEmail", null);
fastify.addHook("onRequest", createSessionGuard(authConfig));
fastify.addHook("onSend", async (_request, reply, payload) => {
  reply.header("Cache-Control", "no-store");
  return payload;
});

// Register routes under /api prefix.
await fastify.register(authRoutes, { prefix: "/api", authConfig });
await fastify.register(accountRoutes, { prefix: "/api" });
await fastify.register(agentsRoutes, { prefix: "/api" });
await fastify.register(agentRoutes, { prefix: "/api" });
await fastify.register(healthRoutes, { prefix: "/api" });
await fastify.register(scanRoutes, { prefix: "/api" });
await fastify.register(findingRoutes, { prefix: "/api" });
await fastify.register(settingsRoutes, { prefix: "/api" });
await fastify.register(deviceRoutes, { prefix: "/api" });

// Graceful shutdown.
const shutdown = async (signal: string) => {
  fastify.log.info(`Received ${signal}, shutting down...`);
  stopScheduler();
  await fastify.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Startup.
try {
  // Recover stale scans from a previous crash before accepting requests.
  await recoverStaleScan();

  await fastify.listen({ host: HOST, port: PORT });
  fastify.log.info(`API listening on http://${HOST}:${PORT}`);

  // Start the scheduler after the server is ready.
  startScheduler();
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

