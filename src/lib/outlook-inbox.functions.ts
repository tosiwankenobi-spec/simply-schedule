import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  SmartInboxAcceptResult,
  SmartInboxCandidate,
  SmartInboxScanResult,
} from "./outlook-inbox.server";

export type {
  SmartInboxAcceptResult,
  SmartInboxCandidate,
  SmartInboxScanResult,
} from "./outlook-inbox.server";

const graphId = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine((value) =>
    Array.from(value).every((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    }),
  );
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/);
const proof = z.string().regex(/^[0-9a-f]{64}$/);
const nullableText = (max: number) => z.string().trim().max(max).nullable();

const candidateSchema = z
  .object({
    messageId: graphId,
    threadId: graphId.nullable(),
    from: z.string().trim().max(320),
    subject: z.string().trim().max(300),
    kind: z.enum(["appointment", "reservation", "school_event", "delivery", "renewal", "deadline"]),
    destination: z.enum(["schedule", "tasks"]),
    title: z.string().trim().min(1).max(200),
    starts_at: z.string().datetime({ offset: true }).nullable(),
    ends_at: z.string().datetime({ offset: true }).nullable(),
    deadline: z.string().date().nullable(),
    estimated_min: z.number().int().min(5).max(480),
    location: nullableText(300),
    notes: nullableText(2000),
    connectionFingerprint: fingerprint,
    proof,
  })
  .superRefine((candidate, context) => {
    if (candidate.destination === "schedule" && !candidate.starts_at) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["starts_at"],
        message: "Schedule suggestions need a start time.",
      });
    }
    if (candidate.destination === "tasks" && !candidate.deadline) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deadline"],
        message: "Task suggestions need a deadline.",
      });
    }
    if (candidate.ends_at && candidate.starts_at) {
      const duration = Date.parse(candidate.ends_at) - Date.parse(candidate.starts_at);
      if (duration <= 0 || duration > 7 * 86400000) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ends_at"],
          message: "The suggested time range is invalid.",
        });
      }
    }
  });

export const scanOutlookSmartInbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ tzOffsetMin: z.number().int().min(-840).max(840) }))
  .handler(async ({ data, context }): Promise<SmartInboxScanResult> => {
    const { scanOutlookInbox } = await import("./outlook-inbox.server");
    return scanOutlookInbox(context.supabase as never, context.userId, data.tzOffsetMin);
  });

export const acceptOutlookSmartInboxCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(candidateSchema)
  .handler(async ({ data, context }): Promise<SmartInboxAcceptResult> => {
    const { acceptOutlookCandidate } = await import("./outlook-inbox.server");
    return acceptOutlookCandidate(context.supabase as never, context.userId, {
      ...data,
      conflicts: 0,
    } as SmartInboxCandidate);
  });

export const dismissOutlookSmartInboxCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ messageId: graphId, connectionFingerprint: fingerprint }))
  .handler(async ({ data, context }): Promise<{ dismissed: true }> => {
    const { dismissOutlookCandidate } = await import("./outlook-inbox.server");
    return dismissOutlookCandidate(
      context.supabase as never,
      context.userId,
      data.messageId,
      data.connectionFingerprint,
    );
  });
