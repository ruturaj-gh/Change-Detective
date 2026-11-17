import type { FastifyReply, FastifyRequest } from "fastify";

export function getSessionUserId(
  request: FastifyRequest,
  reply: FastifyReply
): string | null {
  if (!request.authUserId) {
    reply.status(401).send({ error: "UNAUTHENTICATED" });
    return null;
  }
  return request.authUserId;
}
