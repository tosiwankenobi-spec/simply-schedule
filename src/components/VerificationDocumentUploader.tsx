import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  deleteVerificationDocument,
  listVerificationDocuments,
  recordVerificationDocument,
} from "@/lib/verification-documents.functions";

const BUCKET = "verification-documents";
const MAX_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const ACCEPTED_EXTENSIONS = [".pdf", ".docx"];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isAcceptedFile(file: File) {
  if (ACCEPTED_TYPES.includes(file.type)) return true;
  const lower = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function generateStoragePath(userId: string, file: File) {
  const ext = file.name.toLowerCase().endsWith(".docx") ? "docx" : "pdf";
  const id = crypto.randomUUID();
  return `${userId}/${id}.${ext}`;
}

export function VerificationDocumentUploader() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const documents = useQuery({
    queryKey: ["verification-documents"],
    queryFn: () => listVerificationDocuments(),
  });

  const record = useMutation({
    mutationFn: recordVerificationDocument,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["verification-documents"] });
      toast.success("Document uploaded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: deleteVerificationDocument,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["verification-documents"] });
      toast.success("Document removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleFile = useCallback(
    async (file: File) => {
      if (!isAcceptedFile(file)) {
        toast.error("Only PDF and DOCX files are accepted.");
        return;
      }
      if (file.size > MAX_SIZE_BYTES) {
        toast.error("File must be 10 MB or smaller.");
        return;
      }

      setUploading(true);
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (userError || !user) throw new Error("Sign in to upload documents.");

        const storagePath = generateStoragePath(user.id, file);
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type || ACCEPTED_TYPES[0],
          });

        if (uploadError) throw new Error(uploadError.message);

        await record.mutateAsync({
          data: {
            filename: file.name,
            storagePath,
            contentType: file.type as "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            sizeBytes: file.size,
          },
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [record],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  useEffect(() => {
    function preventDefaults(e: DragEvent) {
      e.preventDefault();
    }
    window.addEventListener("dragover", preventDefaults);
    window.addEventListener("drop", preventDefaults);
    return () => {
      window.removeEventListener("dragover", preventDefaults);
      window.removeEventListener("drop", preventDefaults);
    };
  }, []);

  return (
    <Card className="rounded-2xl bg-card/90 shadow-[0_18px_45px_rgba(0,46,40,0.04)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" /> Verification documents
        </CardTitle>
        <CardDescription>
          Accepted formats: PDF, DOCX. Max file size: 10 MB.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div
          onDragEnter={() => setIsDragging(true)}
          onDragLeave={() => setIsDragging(false)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className={
            "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition-colors " +
            (isDragging
              ? "border-accent bg-accent/5"
              : "border-border bg-secondary/25 hover:border-accent/50 hover:bg-accent/[0.02]")
          }
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
            disabled={uploading}
          />
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-background text-accent ring-1 ring-border">
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">
              {uploading ? "Uploading…" : "Drag a document here, or click to browse"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              PDF or DOCX · up to 10 MB
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            Select file
          </Button>
        </div>

        {documents.data?.length ? (
          <ul className="space-y-2">
            {documents.data.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/60 px-3 py-2"
              >
                <FileText className="h-4 w-4 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{doc.filename}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(doc.size_bytes)}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => remove.mutate({ data: { id: doc.id } })}
                  disabled={remove.isPending}
                  aria-label={`Remove ${doc.filename}`}
                >
                  {remove.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        ) : documents.isLoading ? (
          <div className="space-y-2">
            <div className="h-10 animate-pulse rounded-xl bg-secondary" />
            <div className="h-10 animate-pulse rounded-xl bg-secondary" />
          </div>
        ) : null}

        <p className="text-xs leading-5 text-muted-foreground">
          All documents are securely stored and used solely for verification, in compliance with
          Microsoft&apos;s privacy and data protection policies.
        </p>
      </CardContent>
    </Card>
  );
}
