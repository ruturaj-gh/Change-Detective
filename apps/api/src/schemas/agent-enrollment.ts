import { z } from "zod";
import path from "node:path";

export function isAgentRootAbsolute(osName: string, root: string): boolean {
  if (osName !== "Windows") return path.posix.isAbsolute(root);
  return (
    path.win32.isAbsolute(root) &&
    (/^[A-Za-z]:[\\/]/.test(root) || root.startsWith("\\\\"))
  );
}

export const AgentEnrollmentSchema = z
  .object({
    enrollmentToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    name: z.string().trim().min(1).max(128),
    osName: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9 .()_-]+$/),
    monitoredRoot: z.string().trim().min(1).max(4096),
  })
  .superRefine(({ osName, monitoredRoot }, context) => {
    if (
      !isAgentRootAbsolute(osName, monitoredRoot) ||
      monitoredRoot.includes("\0")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["monitoredRoot"],
        message: "Must be an absolute path for the enrolled agent's operating system.",
      });
    }
  });
