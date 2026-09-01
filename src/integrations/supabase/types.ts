export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      android_oauth_config: {
        Row: {
          android_client_id: string | null
          created_at: string
          debug_sha1: string | null
          id: string
          notes: string | null
          package_name: string | null
          play_sha1: string | null
          release_sha1: string | null
          updated_at: string
          user_id: string
          web_client_id: string | null
        }
        Insert: {
          android_client_id?: string | null
          created_at?: string
          debug_sha1?: string | null
          id?: string
          notes?: string | null
          package_name?: string | null
          play_sha1?: string | null
          release_sha1?: string | null
          updated_at?: string
          user_id: string
          web_client_id?: string | null
        }
        Update: {
          android_client_id?: string | null
          created_at?: string
          debug_sha1?: string | null
          id?: string
          notes?: string | null
          package_name?: string | null
          play_sha1?: string | null
          release_sha1?: string | null
          updated_at?: string
          user_id?: string
          web_client_id?: string | null
        }
        Relationships: []
      }
      appointments: {
        Row: {
          calendar_etag: string | null
          calendar_event_id: string | null
          calendar_id: string | null
          created_at: string
          ends_at: string | null
          external_id: string | null
          gmail_from: string | null
          gmail_message_id: string | null
          gmail_replied_at: string | null
          gmail_reply_state: string | null
          gmail_subject: string | null
          gmail_thread_id: string | null
          id: string
          last_synced_at: string | null
          location: string | null
          notes: string | null
          remote_updated_at: string | null
          source: string
          starts_at: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          calendar_etag?: string | null
          calendar_event_id?: string | null
          calendar_id?: string | null
          created_at?: string
          ends_at?: string | null
          external_id?: string | null
          gmail_from?: string | null
          gmail_message_id?: string | null
          gmail_replied_at?: string | null
          gmail_reply_state?: string | null
          gmail_subject?: string | null
          gmail_thread_id?: string | null
          id?: string
          last_synced_at?: string | null
          location?: string | null
          notes?: string | null
          remote_updated_at?: string | null
          source?: string
          starts_at: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          calendar_etag?: string | null
          calendar_event_id?: string | null
          calendar_id?: string | null
          created_at?: string
          ends_at?: string | null
          external_id?: string | null
          gmail_from?: string | null
          gmail_message_id?: string | null
          gmail_replied_at?: string | null
          gmail_reply_state?: string | null
          gmail_subject?: string | null
          gmail_thread_id?: string | null
          id?: string
          last_synced_at?: string | null
          location?: string | null
          notes?: string | null
          remote_updated_at?: string | null
          source?: string
          starts_at?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_log: {
        Row: {
          body: string
          channels: string[]
          created_at: string
          dedupe_key: string
          emailed_at: string | null
          id: string
          kind: string
          seen_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          channels?: string[]
          created_at?: string
          dedupe_key: string
          emailed_at?: string | null
          id?: string
          kind: string
          seen_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          channels?: string[]
          created_at?: string
          dedupe_key?: string
          emailed_at?: string | null
          id?: string
          kind?: string
          seen_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_prefs: {
        Row: {
          appointment_lead_min: number[]
          created_at: string
          email_enabled: boolean
          email_to: string | null
          id: string
          nudge_enabled: boolean
          nudge_interval_min: number
          overdue_grace_min: number
          overdue_tasks_enabled: boolean
          push_enabled: boolean
          quiet_end: string
          quiet_start: string
          updated_at: string
          user_id: string
        }
        Insert: {
          appointment_lead_min?: number[]
          created_at?: string
          email_enabled?: boolean
          email_to?: string | null
          id?: string
          nudge_enabled?: boolean
          nudge_interval_min?: number
          overdue_grace_min?: number
          overdue_tasks_enabled?: boolean
          push_enabled?: boolean
          quiet_end?: string
          quiet_start?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          appointment_lead_min?: number[]
          created_at?: string
          email_enabled?: boolean
          email_to?: string | null
          id?: string
          nudge_enabled?: boolean
          nudge_interval_min?: number
          overdue_grace_min?: number
          overdue_tasks_enabled?: boolean
          push_enabled?: boolean
          quiet_end?: string
          quiet_start?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_calendar_deletions: {
        Row: {
          calendar_event_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          calendar_event_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          calendar_event_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      planner_profile_assignments: {
        Row: {
          created_at: string
          end_date: string
          id: string
          profile_id: string
          start_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          profile_id: string
          start_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          profile_id?: string
          start_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planner_profile_assignments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "planner_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      planner_profiles: {
        Row: {
          break_every_min: number
          break_length_min: number
          created_at: string
          default_meeting_min: number
          id: string
          is_default: boolean
          lunch_at: string
          lunch_length_min: number
          name: string
          notes: string | null
          updated_at: string
          user_id: string
          work_end: string
          work_start: string
        }
        Insert: {
          break_every_min?: number
          break_length_min?: number
          created_at?: string
          default_meeting_min?: number
          id?: string
          is_default?: boolean
          lunch_at?: string
          lunch_length_min?: number
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
          work_end?: string
          work_start?: string
        }
        Update: {
          break_every_min?: number
          break_length_min?: number
          created_at?: string
          default_meeting_min?: number
          id?: string
          is_default?: boolean
          lunch_at?: string
          lunch_length_min?: number
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
          work_end?: string
          work_start?: string
        }
        Relationships: []
      }
      sync_log: {
        Row: {
          calendar_id: string | null
          created_at: string
          detail: Json | null
          id: string
          kind: string
          level: string
          message: string
          user_id: string
        }
        Insert: {
          calendar_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          kind: string
          level?: string
          message: string
          user_id: string
        }
        Update: {
          calendar_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          kind?: string
          level?: string
          message?: string
          user_id?: string
        }
        Relationships: []
      }
      sync_settings: {
        Row: {
          auto_sync_enabled: boolean
          conflict_policy: string
          created_at: string
          gmail_sync_enabled: boolean
          id: string
          selected_calendar_ids: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_sync_enabled?: boolean
          conflict_policy?: string
          created_at?: string
          gmail_sync_enabled?: boolean
          id?: string
          selected_calendar_ids?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_sync_enabled?: boolean
          conflict_policy?: string
          created_at?: string
          gmail_sync_enabled?: boolean
          id?: string
          selected_calendar_ids?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sync_state: {
        Row: {
          calendar_id: string | null
          created_at: string
          cursor: string | null
          events_seen: number
          id: string
          last_error: string | null
          last_synced_at: string | null
          pages_synced: number
          provider: string
          sync_token: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          calendar_id?: string | null
          created_at?: string
          cursor?: string | null
          events_seen?: number
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          pages_synced?: number
          provider: string
          sync_token?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          calendar_id?: string | null
          created_at?: string
          cursor?: string | null
          events_seen?: number
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          pages_synced?: number
          provider?: string
          sync_token?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          created_at: string
          deadline: string | null
          energy: string
          estimated_min: number
          id: string
          notes: string | null
          priority: number
          scheduled_appointment_id: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deadline?: string | null
          energy?: string
          estimated_min?: number
          id?: string
          notes?: string | null
          priority?: number
          scheduled_appointment_id?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deadline?: string | null
          energy?: string
          estimated_min?: number
          id?: string
          notes?: string | null
          priority?: number
          scheduled_appointment_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_scheduled_appointment_id_fkey"
            columns: ["scheduled_appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_scheduled_appointment_id_fkey"
            columns: ["scheduled_appointment_id"]
            isOneToOne: false
            referencedRelation: "schedule_hub_events"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      schedule_hub_events: {
        Row: {
          calendar_event_id: string | null
          calendar_id: string | null
          commitment_type: string | null
          created_at: string | null
          duration_min: number | null
          ends_at: string | null
          id: string | null
          is_all_day: boolean | null
          location: string | null
          notes: string | null
          privacy_level: string | null
          provider: string | null
          provider_account_id: string | null
          recurrence_rule: string | null
          source: string | null
          source_label: string | null
          starts_at: string | null
          sync_status: string | null
          timezone: string | null
          title: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          calendar_event_id?: string | null
          calendar_id?: string | null
          commitment_type?: never
          created_at?: string | null
          duration_min?: never
          ends_at?: string | null
          id?: string | null
          is_all_day?: never
          location?: string | null
          notes?: string | null
          privacy_level?: never
          provider?: never
          provider_account_id?: never
          recurrence_rule?: never
          source?: string | null
          source_label?: never
          starts_at?: string | null
          sync_status?: never
          timezone?: never
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          calendar_event_id?: string | null
          calendar_id?: string | null
          commitment_type?: never
          created_at?: string | null
          duration_min?: never
          ends_at?: string | null
          id?: string | null
          is_all_day?: never
          location?: string | null
          notes?: string | null
          privacy_level?: never
          provider?: never
          provider_account_id?: never
          recurrence_rule?: never
          source?: string | null
          source_label?: never
          starts_at?: string | null
          sync_status?: never
          timezone?: never
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
