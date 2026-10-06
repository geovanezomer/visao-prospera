export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string;
          actor_email: string | null;
          actor_id: string | null;
          created_at: string;
          id: string;
          ip: string | null;
          metadata: Json;
          resource: string;
          target_id: string | null;
          target_label: string | null;
          user_agent: string | null;
        };
        Insert: {
          action: string;
          actor_email?: string | null;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          ip?: string | null;
          metadata?: Json;
          resource: string;
          target_id?: string | null;
          target_label?: string | null;
          user_agent?: string | null;
        };
        Update: {
          action?: string;
          actor_email?: string | null;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          ip?: string | null;
          metadata?: Json;
          resource?: string;
          target_id?: string | null;
          target_label?: string | null;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          key: string;
          updated_at: string;
          updated_by: string | null;
          value: Json;
        };
        Insert: {
          key: string;
          updated_at?: string;
          updated_by?: string | null;
          value?: Json;
        };
        Update: {
          key?: string;
          updated_at?: string;
          updated_by?: string | null;
          value?: Json;
        };
        Relationships: [];
      };
      broadcasts: {
        Row: {
          created_at: string;
          created_by: string | null;
          failed_count: number;
          html: string;
          id: string;
          segment: Json;
          sent_at: string | null;
          sent_count: number;
          status: string;
          subject: string;
          total_recipients: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          failed_count?: number;
          html: string;
          id?: string;
          segment?: Json;
          sent_at?: string | null;
          sent_count?: number;
          status?: string;
          subject: string;
          total_recipients?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          failed_count?: number;
          html?: string;
          id?: string;
          segment?: Json;
          sent_at?: string | null;
          sent_count?: number;
          status?: string;
          subject?: string;
          total_recipients?: number;
        };
        Relationships: [];
      };
      checkout_intents: {
        Row: {
          checkout_url: string | null;
          confirmed_at: string | null;
          created_at: string;
          currency: string | null;
          email: string;
          id: string;
          idempotency_key: string | null;
          ip: string | null;
          last_error: string | null;
          payment_method: string | null;
          plan_amount_cents: number | null;
          plan_slug: string;
          provider: string;
          provider_customer_id: string | null;
          provider_session_id: string | null;
          provider_subscription_id: string | null;
          status: string;
          updated_at: string;
          upsell_amount_cents: number | null;
          user_agent: string | null;
          with_upsell: boolean;
        };
        Insert: {
          checkout_url?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          currency?: string | null;
          email: string;
          id?: string;
          idempotency_key?: string | null;
          ip?: string | null;
          last_error?: string | null;
          payment_method?: string | null;
          plan_amount_cents?: number | null;
          plan_slug: string;
          provider: string;
          provider_customer_id?: string | null;
          provider_session_id?: string | null;
          provider_subscription_id?: string | null;
          status?: string;
          updated_at?: string;
          upsell_amount_cents?: number | null;
          user_agent?: string | null;
          with_upsell?: boolean;
        };
        Update: {
          checkout_url?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          currency?: string | null;
          email?: string;
          id?: string;
          idempotency_key?: string | null;
          ip?: string | null;
          last_error?: string | null;
          payment_method?: string | null;
          plan_amount_cents?: number | null;
          plan_slug?: string;
          provider?: string;
          provider_customer_id?: string | null;
          provider_session_id?: string | null;
          provider_subscription_id?: string | null;
          status?: string;
          updated_at?: string;
          upsell_amount_cents?: number | null;
          user_agent?: string | null;
          with_upsell?: boolean;
        };
        Relationships: [];
      };
      email_log: {
        Row: {
          id: string;
          kind: string;
          sent_at: string;
          sent_to_hash: string;
          subscription_id: string | null;
        };
        Insert: {
          id?: string;
          kind: string;
          sent_at?: string;
          sent_to_hash: string;
          subscription_id?: string | null;
        };
        Update: {
          id?: string;
          kind?: string;
          sent_at?: string;
          sent_to_hash?: string;
          subscription_id?: string | null;
        };
        Relationships: [];
      };
      email_settings: {
        Row: {
          from_email: string | null;
          from_name: string | null;
          id: string;
          reply_to: string | null;
          resend_api_key: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          from_email?: string | null;
          from_name?: string | null;
          id?: string;
          reply_to?: string | null;
          resend_api_key?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          from_email?: string | null;
          from_name?: string | null;
          id?: string;
          reply_to?: string | null;
          resend_api_key?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      email_templates: {
        Row: {
          enabled: boolean;
          html: string;
          id: string;
          kind: string;
          subject: string;
          text: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          enabled?: boolean;
          html: string;
          id?: string;
          kind: string;
          subject: string;
          text?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          enabled?: boolean;
          html?: string;
          id?: string;
          kind?: string;
          subject?: string;
          text?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      feature_flags: {
        Row: {
          allowed_emails: string[];
          allowed_plans: string[];
          created_at: string;
          description: string | null;
          enabled: boolean;
          key: string;
          rollout_percent: number;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          allowed_emails?: string[];
          allowed_plans?: string[];
          created_at?: string;
          description?: string | null;
          enabled?: boolean;
          key: string;
          rollout_percent?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          allowed_emails?: string[];
          allowed_plans?: string[];
          created_at?: string;
          description?: string | null;
          enabled?: boolean;
          key?: string;
          rollout_percent?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      notification_settings: {
        Row: {
          email_to: string | null;
          events: Json;
          id: number;
          slack_webhook_url: string | null;
          updated_at: string;
        };
        Insert: {
          email_to?: string | null;
          events?: Json;
          id?: number;
          slack_webhook_url?: string | null;
          updated_at?: string;
        };
        Update: {
          email_to?: string | null;
          events?: Json;
          id?: number;
          slack_webhook_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      plans: {
        Row: {
          active: boolean;
          asaas_plan_ref: string | null;
          created_at: string;
          currency: string;
          description: string | null;
          features: Json;
          id: string;
          interval: string;
          limits: Json;
          name: string;
          price_cents: number;
          slug: string;
          sort_order: number;
          stripe_price_id: string | null;
          updated_at: string;
          upsell_asaas_ref: string | null;
          upsell_description: string | null;
          upsell_enabled: boolean;
          upsell_name: string | null;
          upsell_price_cents: number;
          upsell_stripe_price_id: string | null;
        };
        Insert: {
          active?: boolean;
          asaas_plan_ref?: string | null;
          created_at?: string;
          currency?: string;
          description?: string | null;
          features?: Json;
          id?: string;
          interval?: string;
          limits?: Json;
          name: string;
          price_cents?: number;
          slug: string;
          sort_order?: number;
          stripe_price_id?: string | null;
          updated_at?: string;
          upsell_asaas_ref?: string | null;
          upsell_description?: string | null;
          upsell_enabled?: boolean;
          upsell_name?: string | null;
          upsell_price_cents?: number;
          upsell_stripe_price_id?: string | null;
        };
        Update: {
          active?: boolean;
          asaas_plan_ref?: string | null;
          created_at?: string;
          currency?: string;
          description?: string | null;
          features?: Json;
          id?: string;
          interval?: string;
          limits?: Json;
          name?: string;
          price_cents?: number;
          slug?: string;
          sort_order?: number;
          stripe_price_id?: string | null;
          updated_at?: string;
          upsell_asaas_ref?: string | null;
          upsell_description?: string | null;
          upsell_enabled?: boolean;
          upsell_name?: string | null;
          upsell_price_cents?: number;
          upsell_stripe_price_id?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
        };
        Relationships: [];
      };
      provider_credentials: {
        Row: {
          api_key: string | null;
          created_at: string;
          id: string;
          is_active: boolean;
          mode: string;
          provider: string;
          updated_at: string;
          updated_by: string | null;
          webhook_secret: string | null;
        };
        Insert: {
          api_key?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          mode?: string;
          provider: string;
          updated_at?: string;
          updated_by?: string | null;
          webhook_secret?: string | null;
        };
        Update: {
          api_key?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          mode?: string;
          provider?: string;
          updated_at?: string;
          updated_by?: string | null;
          webhook_secret?: string | null;
        };
        Relationships: [];
      };
      rate_limit_buckets: {
        Row: {
          bucket_key: string;
          count: number;
          reset_at: string;
        };
        Insert: {
          bucket_key: string;
          count?: number;
          reset_at: string;
        };
        Update: {
          bucket_key?: string;
          count?: number;
          reset_at?: string;
        };
        Relationships: [];
      };
      shared_reports: {
        Row: {
          company_name: string;
          created_at: string;
          expires_at: string | null;
          owner_id: string;
          revoked_at: string | null;
          share_id: string;
          storage_path: string;
        };
        Insert: {
          company_name: string;
          created_at?: string;
          expires_at?: string | null;
          owner_id: string;
          revoked_at?: string | null;
          share_id: string;
          storage_path: string;
        };
        Update: {
          company_name?: string;
          created_at?: string;
          expires_at?: string | null;
          owner_id?: string;
          revoked_at?: string | null;
          share_id?: string;
          storage_path?: string;
        };
        Relationships: [];
      };
      signup_events: {
        Row: {
          created_at: string;
          email: string | null;
          id: string;
          notified: boolean;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          id?: string;
          notified?: boolean;
          user_id: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          id?: string;
          notified?: boolean;
          user_id?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean;
          created_at: string;
          current_period_end: string | null;
          id: string;
          plan: string;
          price_id: string;
          provider: string;
          provider_customer_id: string | null;
          status: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          plan: string;
          price_id: string;
          provider?: string;
          provider_customer_id?: string | null;
          status: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          cancel_at_period_end?: boolean;
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          plan?: string;
          price_id?: string;
          provider?: string;
          provider_customer_id?: string | null;
          status?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      trial_requests: {
        Row: {
          consumed_at: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          ip: unknown;
          user_id: string | null;
        };
        Insert: {
          consumed_at?: string | null;
          created_at?: string;
          email: string;
          expires_at: string;
          id?: string;
          ip?: unknown;
          user_id?: string | null;
        };
        Update: {
          consumed_at?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          ip?: unknown;
          user_id?: string | null;
        };
        Relationships: [];
      };
      user_emails: {
        Row: {
          created_at: string;
          email: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_notes: {
        Row: {
          author_email: string | null;
          author_id: string | null;
          body: string;
          created_at: string;
          id: string;
          pinned: boolean;
          user_id: string;
        };
        Insert: {
          author_email?: string | null;
          author_id?: string | null;
          body: string;
          created_at?: string;
          id?: string;
          pinned?: boolean;
          user_id: string;
        };
        Update: {
          author_email?: string | null;
          author_id?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          pinned?: boolean;
          user_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      webhook_events: {
        Row: {
          attempt_history: Json;
          attempts: number;
          customer_email: string | null;
          error: string | null;
          event_type: string;
          id: string;
          last_attempt_at: string | null;
          locked_at: string | null;
          next_attempt_at: string | null;
          payload: Json;
          provider: string;
          provider_event_id: string | null;
          received_at: string;
          replayed_at: string | null;
          replayed_by: string | null;
          status: string;
          subscription_id: string | null;
        };
        Insert: {
          attempt_history?: Json;
          attempts?: number;
          customer_email?: string | null;
          error?: string | null;
          event_type: string;
          id?: string;
          last_attempt_at?: string | null;
          locked_at?: string | null;
          next_attempt_at?: string | null;
          payload?: Json;
          provider: string;
          provider_event_id?: string | null;
          received_at?: string;
          replayed_at?: string | null;
          replayed_by?: string | null;
          status?: string;
          subscription_id?: string | null;
        };
        Update: {
          attempt_history?: Json;
          attempts?: number;
          customer_email?: string | null;
          error?: string | null;
          event_type?: string;
          id?: string;
          last_attempt_at?: string | null;
          locked_at?: string | null;
          next_attempt_at?: string | null;
          payload?: Json;
          provider?: string;
          provider_event_id?: string | null;
          received_at?: string;
          replayed_at?: string | null;
          replayed_by?: string | null;
          status?: string;
          subscription_id?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_active_plan: {
        Args: never;
        Returns: {
          cancel_at_period_end: boolean;
          current_period_end: string;
          plan: string;
          provider: string;
          status: string;
        }[];
      };
      has_active_subscription: { Args: { _user_id: string }; Returns: boolean };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      rl_consume: {
        Args: { _key: string; _limit: number; _window_seconds: number };
        Returns: {
          allowed: boolean;
          remaining: number;
          retry_after_seconds: number;
        }[];
      };
      rl_gc: { Args: never; Returns: number };
    };
    Enums: {
      app_role: "admin" | "moderator" | "user";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const;
