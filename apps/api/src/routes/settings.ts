/**
 * Settings routes.
 * GET   /api/settings — current settings
 * PATCH /api/settings — update one or more settings
 */
import type { FastifyPluginAsync } from "fastify";
import {
  getSettings,
  updateSettings,
  SettingsPatchSchema,
  InvalidMonitoredRootError,
} from "../services/settings.service.js";

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/settings", async (_req, reply) => {
    const settings = await getSettings();
    return reply.send({ settings });
  });

  fastify.patch("/settings", async (req, reply) => {
    const body = SettingsPatchSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({
        error: "VALIDATION_ERROR",
        details: body.error.flatten(),
      });
    }
    try {
      const updated = await updateSettings(body.data);
      return reply.send({ settings: updated });
    } catch (err) {
      if (err instanceof InvalidMonitoredRootError) {
        return reply.status(400).send({ error: "INVALID_MONITORED_ROOT", message: err.message });
      }
      throw err;
    }
  });
};
