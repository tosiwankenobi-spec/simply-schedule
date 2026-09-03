import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  SmartInboxAcceptResult,
  SmartInboxCandidate,
  SmartInboxScanResult,
} from "./gmail-inbox.server";

export type {
  SmartInboxAcceptResult,
  SmartInboxCandidate,
  SmartInboxScanResult,
} from "./gmail-inbox.server";

const gmailIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const nullableText = (max: number) => z.string().trim().max(max).nullable();

const candidateSchema = z
  .object({
    messageId: gmailIdSchema,
    threadId: gmailIdSchema.nullable(),
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
  })
  .superRefine((candidate, ctx) => {
    if (candidate.destination === "schedule" && !candidate.starts_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["starts_at"],
        message: "Schedule suggestions need a start time.",
      });
    }
    if (candidate.destination === "tasks" && !candidate.deadline) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deadline"],
        message: "Task suggestions need a deadline.",
      });
    }
    if (
      ((candidate.kind === "renewal" || candidate.kind === "deadline") &&
        candidate.destination !== "tasks") ||
      ((candidate.kind === "appointment" ||
        candidate.kind === "reservation" ||
        candidate.kind === "school_event") &&
        candidate.destination !== "schedule")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destination"],
        message: "That suggestion type has an invalid destination.",
      });
    }
    if (candidate.ends_at && candidate.starts_at) {
      const start = Date.parse(candidate.starts_at);
      const end = Date.parse(candidate.ends_at);
      if (end <= start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ends_at"],
          message: "End time must be after the start time.",
        });
      } else if (end - start > 7 * 86400000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ends_at"],
          message: "An inbox appointment cannot be longer than seven days.",
        });
      }
    }
  });

export const scanGmailInbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      tzOffsetMin: z.number().int().min(-840).max(840),
    }),
  )
  .handler(async ({ data, context }): Promise<SmartInboxScanResult> => {
    const { scanSmartInbox } = await import("./gmail-inbox.server");
    return scanSmartInbox(context.supabase as never, context.userId, data.tzOffsetMin);
  });

export const acceptGmailCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(candidateSchema)
  .handler(async ({ data, context }): Promise<SmartInboxAcceptResult> => {
    const { acceptSmartInboxCandidate } = await import("./gmail-inbox.server");
    return acceptSmartInboxCandidate(
      context.supabase as never,
      context.userId,
      data as SmartInboxCandidate,
    );
  });

export const dismissGmailCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ messageId: gmailIdSchema }))
  .handler(async ({ data, context }): Promise<{ dismissed: true }> => {
    const { dismissSmartInboxCandidate } = await import("./gmail-inbox.server");
    return dismissSmartInboxCandidate(context.supabase as never, context.userId, data.messageId);
  });
