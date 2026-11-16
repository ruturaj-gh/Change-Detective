import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { verifyPassword } from "../auth/credentials.js";
import {
  AuthConfig,
  clearSessionCookie,
  createSessionCookie,
  createSessionToken,
  getSessionCookie,
  verifySessionToken,
} from "../auth/session.js";

interface AuthRouteOptions {
  authConfig: AuthConfig | null;
}

const LoginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (
  fastify,
  { authConfig }
) => {
  fastify.post("/auth/login", {
    config: { rateLimit: { max: 5, timeWindow: 15 * 60 * 1000 } },
    handler: async (req, reply) => {
      if (!authConfig) {
        return reply.status(404).send({ error: "AUTHENTICATION_DISABLED" });
      }

      const body = LoginSchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: "INVALID_CREDENTIALS" });
      }

      const passwordMatches = await verifyPassword(
        body.data.password,
        authConfig.passwordHash
      );
      if (
        body.data.email.toLowerCase() !== authConfig.email ||
        !passwordMatches
      ) {
        return reply.status(401).send({ error: "INVALID_CREDENTIALS" });
      }

      const token = createSessionToken(authConfig.email, authConfig.secret);
      const secure = process.env["NODE_ENV"] === "production";
      return reply
        .header("Set-Cookie", createSessionCookie(token, secure))
        .send({ authenticated: true, email: authConfig.email });
    },
  });

  fastify.get("/auth/session", async (req, reply) => {
    if (!authConfig) {
      return reply.send({ authenticated: true, authenticationEnabled: false });
    }

    const token = getSessionCookie(req.headers.cookie);
    if (!verifySessionToken(token, authConfig)) {
      return reply.status(401).send({ authenticated: false });
    }
    return reply.send({
      authenticated: true,
      authenticationEnabled: true,
      email: authConfig.email,
    });
  });

  fastify.post("/auth/logout", async (_req, reply) => {
    const secure = process.env["NODE_ENV"] === "production";
    return reply
      .header("Set-Cookie", clearSessionCookie(secure))
      .send({ authenticated: false });
  });
};
