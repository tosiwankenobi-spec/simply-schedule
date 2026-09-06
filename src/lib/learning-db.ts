/**
 * Local typing for the staged learning tables/RPCs.
 *
 * The generated Supabase types file is regenerated from the live schema, and
 * this feature's migration is intentionally not applied yet. This module adds
 * the exact shape of the staged schema so the code is fully typed today, and
 * can be deleted once the generated types include these tables.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type LearningEventRow = {
  id: string;
  user_id: string;
  kind: string;
  conflict_strategy: string | null;
  offered_count: number;
  approved_count: number;
  moved_count: number;
  restored_count: number;
  left_alone_count: number;
  local_hour: number | null;
  local_dow: number | null;
  created_at: string;
};

export type LearningSettingsRow = {
  id: string;
  user_id: string;
  enabled: boolean;
  accepted_conflict_strategy: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
};

type Tables = Database["public"]["Tables"] & {
  learning_events: {
    Row: LearningEventRow;
    Insert: Partial<LearningEventRow> & { user_id: string; kind: string };
    Update: Partial<LearningEventRow>;
    Relationships: [];
  };
  learning_settings: {
    Row: LearningSettingsRow;
    Insert: Partial<LearningSettingsRow> & { user_id: string };
    Update: Partial<LearningSettingsRow>;
    Relationships: [];
  };
};

type Functions = Database["public"]["Functions"] & {
  record_learning_event: {
    Args: {
      p_kind: string;
      p_conflict_strategy?: string | null;
      p_offered?: number;
      p_approved?: number;
      p_moved?: number;
      p_restored?: number;
      p_left_alone?: number;
      p_local_hour?: number | null;
      p_local_dow?: number | null;
    };
    Returns: boolean;
  };
  reset_learning_data: {
    Args: Record<string, never>;
    Returns: { deletedEvents?: number };
  };
};

export type LearningDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Tables;
    Functions: Functions;
  };
};

export type LearningClient = SupabaseClient<LearningDatabase, "public">;

/** Same connection, widened typing for the staged learning schema. */
export function learningDb(supabase: SupabaseClient<Database>): LearningClient {
  return supabase as unknown as LearningClient;
}
