import { z } from "zod";

const ByteStringSchema = z.string().regex(/^\d{1,40}$/);

export const AgentScanResultSchema = z.object({
  rootPath: z.string().min(1).max(4096),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().int().min(0).max(2_147_483_647),
  status: z.enum(["completed", "partial", "failed", "cancelled"]),
  diskMetrics: z
    .object({
      totalBytes: ByteStringSchema,
      freeBytes: ByteStringSchema,
    })
    .nullable(),
  directories: z
    .array(
      z.object({
        normalizedPath: z.string().min(1).max(4096),
        displayName: z.string().min(1).max(1024),
        sizeBytes: ByteStringSchema,
        filesCount: ByteStringSchema.nullable(),
        directoriesCount: ByteStringSchema.nullable(),
        measurementComplete: z.boolean(),
      })
    )
    .max(20_000),
  scannedDirectoryCount: z.number().int().min(0).max(20_000),
  inaccessibleDirectoryCount: z.number().int().min(0).max(20_000),
  totalErrorCount: z.number().int().min(0).max(1_000_000),
  errorMessage: z.string().max(4096).nullable(),
}).superRefine((result, context) => {
  if (new Date(result.completedAt) < new Date(result.startedAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["completedAt"],
      message: "Must not be earlier than startedAt.",
    });
  }
  if (result.scannedDirectoryCount !== result.directories.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scannedDirectoryCount"],
      message: "Must match the number of submitted directory measurements.",
    });
  }
  if (result.inaccessibleDirectoryCount > result.scannedDirectoryCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inaccessibleDirectoryCount"],
      message: "Cannot exceed the number of scanned directories.",
    });
  }
});

export type AgentScanResult = z.infer<typeof AgentScanResultSchema>;
