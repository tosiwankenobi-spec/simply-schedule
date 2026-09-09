/**
 * Server functions for the verification document vault.
 * Documents are stored in the private `verification-documents` Supabase Storage bucket
 * and tracked in `public.verification_documents`. Users can only manage files inside
 * their own folder.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ACCEPTED_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const recordSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  storagePath: z.string().trim().min(1).max(500),
  contentType: z.enum(ACCEPTED_CONTENT_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_FILE_SIZE_BYTES),
  purpose: z.string().trim().min(1).max(120).default("microsoft_publisher_verification"),
});

const deleteSchema = z.object({
  id: z.string().uuid(),
});

export type VerificationDocument = {
  id: string;
  user_id: string;
  filename: string;
  storage_path: string;
  content_type: string;
  size_bytes: number;
  purpose: string;
  created_at: string;
  updated_at: string;
};

export const listVerificationDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VerificationDocument[]> => {
    const { data, error } = await context.supabase
      .from("verification_documents")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return (data as VerificationDocument[]) ?? [];
  });

export const recordVerificationDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => recordSchema.parse(input))
  .handler(async ({ data, context }): Promise<VerificationDocument> => {
    const expectedPrefix = `${context.userId}/`;
    if (!data.storagePath.startsWith(expectedPrefix)) {
      throw new Error("Storage path does not belong to the signed-in user.");
    }

    const { data: row, error } = await context.supabase
      .from("verification_documents")
      .insert({
        user_id: context.userId,
        filename: data.filename,
        storage_path: data.storagePath,
        content_type: data.contentType,
        size_bytes: data.sizeBytes,
        purpose: data.purpose,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    if (!row) throw new Error("Document record was not created.");
    return row as VerificationDocument;
  });

export const deleteVerificationDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => deleteSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { data: rows, error: fetchError } = await context.supabase
      .from("verification_documents")
      .select("storage_path")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .single();

    if (fetchError || !rows) throw new Error("Document not found.");

    const { storage_path: storagePath } = rows as { storage_path: string };

    // Best-effort storage cleanup; continue if the object is already gone.
    await context.supabase.storage.from("verification-documents").remove([storagePath]);

    const { error: deleteError } = await context.supabase
      .from("verification_documents")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);

    if (deleteError) throw new Error(deleteError.message);
    return { ok: true };
  });
