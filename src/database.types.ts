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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activities: {
        Row: {
          analysis_ignored: boolean
          archived: boolean
          category: string | null
          color: string
          created_at: string
          description: string | null
          emoji: string | null
          id: string
          is_sleep_activity: boolean
          name: string
          productivity_multiplier: number
          focus_demand: number
          user_id: string
        }
        Insert: {
          analysis_ignored?: boolean
          archived?: boolean
          category?: string | null
          color?: string
          created_at?: string
          description?: string | null
          emoji?: string | null
          id?: string
          is_sleep_activity?: boolean
          name: string
          productivity_multiplier?: number
          focus_demand?: number
          user_id: string
        }
        Update: {
          analysis_ignored?: boolean
          archived?: boolean
          category?: string | null
          color?: string
          created_at?: string
          description?: string | null
          emoji?: string | null
          id?: string
          is_sleep_activity?: boolean
          name?: string
          productivity_multiplier?: number
          focus_demand?: number
          user_id?: string
        }
        Relationships: []
      }
      analytics_activity_daily: {
        Row: {
          activity_id: string
          analytics_version: number
          calculated_at: string
          date_key: string
          focus_demand_points: number
          ignored_minutes: number
          judged_minutes: number
          longest_run_minutes: number | null
          minutes: number
          productivity_points: number
          productivity_score: number | null
          run_count: number
          user_id: string
          waste_minutes: number
          waste_points: number
        }
        Insert: {
          activity_id: string
          analytics_version?: number
          calculated_at?: string
          date_key: string
          focus_demand_points?: number
          ignored_minutes?: number
          judged_minutes?: number
          longest_run_minutes?: number | null
          minutes?: number
          productivity_points?: number
          productivity_score?: number | null
          run_count?: number
          user_id: string
          waste_minutes?: number
          waste_points?: number
        }
        Update: {
          activity_id?: string
          analytics_version?: number
          calculated_at?: string
          date_key?: string
          focus_demand_points?: number
          ignored_minutes?: number
          judged_minutes?: number
          longest_run_minutes?: number | null
          minutes?: number
          productivity_points?: number
          productivity_score?: number | null
          run_count?: number
          user_id?: string
          waste_minutes?: number
          waste_points?: number
        }
        Relationships: []
      }
      analytics_daily: {
        Row: {
          analytics_version: number
          attention_efficiency: number | null
          attention_points: number
          calculated_at: string
          coverage_pct: number | null
          cross_switch_count: number
          date_key: string
          elapsed_minutes: number
          goal_minutes: number
          ignored_minutes: number
          judged_minutes: number
          longest_run_minutes: number | null
          mean_run_minutes: number | null
          productivity_points: number
          productivity_score: number | null
          sleep_minutes: number
          switch_count: number
          switches_per_hour: number | null
          task_focus_minutes: number
          tasks_completed: number
          tracked_minutes: number
          untracked_minutes: number
          user_id: string
          waste_minutes: number
          waste_points: number
          waste_share_pct: number | null
        }
        Insert: {
          analytics_version?: number
          attention_efficiency?: number | null
          attention_points?: number
          calculated_at?: string
          coverage_pct?: number | null
          cross_switch_count?: number
          date_key: string
          elapsed_minutes?: number
          goal_minutes?: number
          ignored_minutes?: number
          judged_minutes?: number
          longest_run_minutes?: number | null
          mean_run_minutes?: number | null
          productivity_points?: number
          productivity_score?: number | null
          sleep_minutes?: number
          switch_count?: number
          switches_per_hour?: number | null
          task_focus_minutes?: number
          tasks_completed?: number
          tracked_minutes?: number
          untracked_minutes?: number
          user_id: string
          waste_minutes?: number
          waste_points?: number
          waste_share_pct?: number | null
        }
        Update: {
          analytics_version?: number
          attention_efficiency?: number | null
          attention_points?: number
          calculated_at?: string
          coverage_pct?: number | null
          cross_switch_count?: number
          date_key?: string
          elapsed_minutes?: number
          goal_minutes?: number
          ignored_minutes?: number
          judged_minutes?: number
          longest_run_minutes?: number | null
          mean_run_minutes?: number | null
          productivity_points?: number
          productivity_score?: number | null
          sleep_minutes?: number
          switch_count?: number
          switches_per_hour?: number | null
          task_focus_minutes?: number
          tasks_completed?: number
          tracked_minutes?: number
          untracked_minutes?: number
          user_id?: string
          waste_minutes?: number
          waste_points?: number
          waste_share_pct?: number | null
        }
        Relationships: []
      }
      analytics_goal_daily: {
        Row: {
          analytics_version: number
          calculated_at: string
          cumulative_hours: number
          cumulative_minutes: number
          date_key: string
          goal_id: string
          goal_minutes: number
          linked_habit_completions: number
          linked_task_count: number
          user_id: string
        }
        Insert: {
          analytics_version?: number
          calculated_at?: string
          cumulative_hours?: number
          cumulative_minutes?: number
          date_key: string
          goal_id: string
          goal_minutes?: number
          linked_habit_completions?: number
          linked_task_count?: number
          user_id: string
        }
        Update: {
          analytics_version?: number
          calculated_at?: string
          cumulative_hours?: number
          cumulative_minutes?: number
          date_key?: string
          goal_id?: string
          goal_minutes?: number
          linked_habit_completions?: number
          linked_task_count?: number
          user_id?: string
        }
        Relationships: []
      }
      analytics_habit_daily: {
        Row: {
          analytics_version: number
          calculated_at: string
          completed: boolean
          date_key: string
          due: boolean
          habit_id: string
          log_count: number
          user_id: string
        }
        Insert: {
          analytics_version?: number
          calculated_at?: string
          completed?: boolean
          date_key: string
          due?: boolean
          habit_id: string
          log_count?: number
          user_id: string
        }
        Update: {
          analytics_version?: number
          calculated_at?: string
          completed?: boolean
          date_key?: string
          due?: boolean
          habit_id?: string
          log_count?: number
          user_id?: string
        }
        Relationships: []
      }
      analytics_transition_daily: {
        Row: {
          analytics_version: number
          calculated_at: string
          date_key: string
          from_activity_id: string
          model_version: number
          to_activity_id: string
          transition_count: number
          user_id: string
        }
        Insert: {
          analytics_version?: number
          calculated_at?: string
          date_key: string
          from_activity_id: string
          model_version?: number
          to_activity_id: string
          transition_count?: number
          user_id: string
        }
        Update: {
          analytics_version?: number
          calculated_at?: string
          date_key?: string
          from_activity_id?: string
          model_version?: number
          to_activity_id?: string
          transition_count?: number
          user_id?: string
        }
        Relationships: []
      }
      analytics_routine_daily: {
        Row: {
          analytics_version: number
          calculated_at: string
          date_key: string
          model_version: number
          occurrences: number
          steps: string[]
          user_id: string
        }
        Insert: {
          analytics_version?: number
          calculated_at?: string
          date_key: string
          model_version?: number
          occurrences?: number
          steps: string[]
          user_id: string
        }
        Update: {
          analytics_version?: number
          calculated_at?: string
          date_key?: string
          model_version?: number
          occurrences?: number
          steps?: string[]
          user_id?: string
        }
        Relationships: []
      }
      analytics_dirty_dates: {
        Row: {
          attempts: number
          date_key: string
          first_marked_at: string
          last_marked_at: string
          reason: string | null
          status: string
          user_id: string
        }
        Insert: {
          attempts?: number
          date_key: string
          first_marked_at?: string
          last_marked_at?: string
          reason?: string | null
          status?: string
          user_id: string
        }
        Update: {
          attempts?: number
          date_key?: string
          first_marked_at?: string
          last_marked_at?: string
          reason?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      analytics_runs: {
        Row: {
          analytics_version: number
          error_message: string | null
          finished_at: string | null
          from_date: string | null
          id: number
          rows_processed: number | null
          run_type: string
          started_at: string
          status: string
          to_date: string | null
          user_id: string
        }
        Insert: {
          analytics_version: number
          error_message?: string | null
          finished_at?: string | null
          from_date?: string | null
          id?: number
          rows_processed?: number | null
          run_type: string
          started_at?: string
          status?: string
          to_date?: string | null
          user_id: string
        }
        Update: {
          analytics_version?: number
          error_message?: string | null
          finished_at?: string | null
          from_date?: string | null
          id?: number
          rows_processed?: number | null
          run_type?: string
          started_at?: string
          status?: string
          to_date?: string | null
          user_id?: string
        }
        Relationships: []
      }
      analytics_state: {
        Row: {
          analytics_version: number
          data_version: number
          last_recompute_at: string | null
          user_id: string
        }
        Insert: {
          analytics_version?: number
          data_version?: number
          last_recompute_at?: string | null
          user_id: string
        }
        Update: {
          analytics_version?: number
          data_version?: number
          last_recompute_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ai_analysis_cache: {
        Row: {
          analysis_mode: string
          analytics_version: number
          completed_at: string | null
          data_version: number | null
          error_message: string | null
          from_date: string
          id: string
          model: string
          prompt: string | null
          prompt_version: number
          request_created_at: string
          request_hash: string
          response: Json | null
          started_at: string | null
          status: string
          to_date: string
          user_id: string
        }
        Insert: {
          analysis_mode: string
          analytics_version: number
          completed_at?: string | null
          data_version?: number | null
          error_message?: string | null
          from_date: string
          id?: string
          model: string
          prompt?: string | null
          prompt_version: number
          request_created_at?: string
          request_hash: string
          response?: Json | null
          started_at?: string | null
          status?: string
          to_date: string
          user_id: string
        }
        Update: {
          analysis_mode?: string
          analytics_version?: number
          completed_at?: string | null
          data_version?: number | null
          error_message?: string | null
          from_date?: string
          id?: string
          model?: string
          prompt?: string | null
          prompt_version?: number
          request_created_at?: string
          request_hash?: string
          response?: Json | null
          started_at?: string | null
          status?: string
          to_date?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_stats: {
        Row: {
          date_key: string
          sleep_minutes: number
          sleep_time: string | null
          total_blocks_assigned: number
          user_id: string
          wake_time: string | null
        }
        Insert: {
          date_key: string
          sleep_minutes?: number
          sleep_time?: string | null
          total_blocks_assigned?: number
          user_id: string
          wake_time?: string | null
        }
        Update: {
          date_key?: string
          sleep_minutes?: number
          sleep_time?: string | null
          total_blocks_assigned?: number
          user_id?: string
          wake_time?: string | null
        }
        Relationships: []
      }
      goals: {
        Row: {
          completion_note: string | null
          created_at: string | null
          description: string | null
          emoji: string | null
          id: string
          linked_activity_ids: string[] | null
          linked_habit_ids: string[] | null
          status: string | null
          target_date: string | null
          target_hours: number | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          completion_note?: string | null
          created_at?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          linked_activity_ids?: string[] | null
          linked_habit_ids?: string[] | null
          status?: string | null
          target_date?: string | null
          target_hours?: number | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          completion_note?: string | null
          created_at?: string | null
          description?: string | null
          emoji?: string | null
          id?: string
          linked_activity_ids?: string[] | null
          linked_habit_ids?: string[] | null
          status?: string | null
          target_date?: string | null
          target_hours?: number | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      habit_logs: {
        Row: {
          date_key: string | null
          habit_id: string
          id: string
          logged_at: string
          notes: string | null
          user_id: string
        }
        Insert: {
          date_key?: string | null
          habit_id: string
          id?: string
          logged_at?: string
          notes?: string | null
          user_id: string
        }
        Update: {
          date_key?: string | null
          habit_id?: string
          id?: string
          logged_at?: string
          notes?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_logs_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
        ]
      }
      habits: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          frequency: string
          id: string
          name: string
          target_count: number | null
          type: string
          user_id: string
          weekdays: number[] | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          frequency?: string
          id?: string
          name: string
          target_count?: number | null
          type?: string
          user_id: string
          weekdays?: number[] | null
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          frequency?: string
          id?: string
          name?: string
          target_count?: number | null
          type?: string
          user_id?: string
          weekdays?: number[] | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          carry_over: string | null
          changed: string | null
          created_at: string
          energy: number | null
          happened: string | null
          id: string
          notes: string | null
          period_key: string
          period_type: string
          planned: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          carry_over?: string | null
          changed?: string | null
          created_at?: string
          energy?: number | null
          happened?: string | null
          id?: string
          notes?: string | null
          period_key: string
          period_type: string
          planned?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          carry_over?: string | null
          changed?: string | null
          created_at?: string
          energy?: number | null
          happened?: string | null
          id?: string
          notes?: string | null
          period_key?: string
          period_type?: string
          planned?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sleep_logs: {
        Row: {
          created_at: string | null
          date_key: string
          energy: number | null
          factors: string[]
          id: string
          notes: string | null
          quality: number | null
          sleep_time: string | null
          total_minutes: number | null
          user_id: string
          wake_time: string | null
        }
        Insert: {
          created_at?: string | null
          date_key: string
          energy?: number | null
          factors?: string[]
          id?: string
          notes?: string | null
          quality?: number | null
          sleep_time?: string | null
          total_minutes?: number | null
          user_id: string
          wake_time?: string | null
        }
        Update: {
          created_at?: string | null
          date_key?: string
          energy?: number | null
          factors?: string[]
          id?: string
          notes?: string | null
          quality?: number | null
          sleep_time?: string | null
          total_minutes?: number | null
          user_id?: string
          wake_time?: string | null
        }
        Relationships: []
      }
      task_focus_sessions: {
        Row: {
          activity_id: string | null
          created_at: string
          duration_minutes: number
          ended_at: string
          id: string
          started_at: string
          task_id: string | null
          timer_type: string
          user_id: string
        }
        Insert: {
          activity_id?: string | null
          created_at?: string
          duration_minutes: number
          ended_at: string
          id?: string
          started_at: string
          task_id?: string | null
          timer_type?: string
          user_id?: string
        }
        Update: {
          activity_id?: string | null
          created_at?: string
          duration_minutes?: number
          ended_at?: string
          id?: string
          started_at?: string
          task_id?: string | null
          timer_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_focus_sessions_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_focus_sessions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          activity_id: string | null
          completed: boolean
          completed_at: string | null
          completed_pomodoros: number
          created_at: string
          date_key: string | null
          deadline: string | null
          description: string | null
          estimated_minutes: number | null
          estimated_pomodoros: number
          id: string
          importance: boolean | null
          recurrence_rule: string | null
          recurrence_type: string | null
          title: string
          urgency: boolean | null
          user_id: string
        }
        Insert: {
          activity_id?: string | null
          completed?: boolean
          completed_at?: string | null
          completed_pomodoros?: number
          created_at?: string
          date_key?: string | null
          deadline?: string | null
          description?: string | null
          estimated_minutes?: number | null
          estimated_pomodoros?: number
          id?: string
          importance?: boolean | null
          recurrence_rule?: string | null
          recurrence_type?: string | null
          title: string
          urgency?: boolean | null
          user_id: string
        }
        Update: {
          activity_id?: string | null
          completed?: boolean
          completed_at?: string | null
          completed_pomodoros?: number
          created_at?: string
          date_key?: string | null
          deadline?: string | null
          description?: string | null
          estimated_minutes?: number | null
          estimated_pomodoros?: number
          id?: string
          importance?: boolean | null
          recurrence_rule?: string | null
          recurrence_type?: string | null
          title?: string
          urgency?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
        ]
      }
      time_blocks: {
        Row: {
          activity_id: string | null
          block_index: number
          created_at: string
          date_key: string
          id: string
          notes: string | null
          task_id: string | null
          user_id: string
        }
        Insert: {
          activity_id?: string | null
          block_index: number
          created_at?: string
          date_key: string
          id?: string
          notes?: string | null
          task_id?: string | null
          user_id: string
        }
        Update: {
          activity_id?: string | null
          block_index?: number
          created_at?: string
          date_key?: string
          id?: string
          notes?: string | null
          task_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_blocks_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_blocks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          created_at: string | null
          default_sleep_time: string | null
          default_wake_time: string | null
          enable_animations: boolean | null
          sleep_goal_hours: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          default_sleep_time?: string | null
          default_wake_time?: string | null
          enable_animations?: boolean | null
          sleep_goal_hours?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          default_sleep_time?: string | null
          default_wake_time?: string | null
          enable_animations?: boolean | null
          sleep_goal_hours?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_activity_analytics_range: {
        Args: { p_from: string; p_to: string; p_user_id: string }
        Returns: {
          activity_id: string
          analytics_version: number
          calculated_at: string
          date_key: string
          focus_demand_points: number
          ignored_minutes: number
          judged_minutes: number
          longest_run_minutes: number | null
          minutes: number
          productivity_points: number
          productivity_score: number | null
          run_count: number
          user_id: string
          waste_minutes: number
          waste_points: number
        }[]
      }
      get_daily_activity_breakdown: {
        Args: { p_date: string; p_user_id: string }
        Returns: {
          activity_id: string
          focus_demand_points: number
          ignored_minutes: number
          judged_minutes: number
          longest_run_minutes: number | null
          minutes: number
          productivity_points: number
          productivity_score: number | null
          run_count: number
          waste_minutes: number
          waste_points: number
        }[]
      }
      get_daily_activity_transitions: {
        Args: { p_date: string; p_user_id: string }
        Returns: { from_activity_id: string; to_activity_id: string; transition_count: number }[]
      }
      get_daily_activity_routines: {
        Args: { p_date: string; p_user_id: string }
        Returns: { occurrences: number; steps: string[] }[]
      }
      get_routine_analytics_range: {
        Args: { p_from: string; p_to: string; p_user_id: string }
        Returns: { occurrences: number; steps: string[] }[]
      }
      get_dashboard_summary: {
        Args: { p_from: string; p_to: string; p_user_id: string }
        Returns: any
      }
      get_daily_analytics_range: {
        Args: { p_from: string; p_to: string; p_user_id: string }
        Returns: {
          analytics_version: number
          attention_efficiency: number | null
          attention_points: number
          calculated_at: string
          coverage_pct: number | null
          cross_switch_count: number
          date_key: string
          elapsed_minutes: number
          goal_minutes: number
          ignored_minutes: number
          judged_minutes: number
          longest_run_minutes: number | null
          mean_run_minutes: number | null
          productivity_points: number
          productivity_score: number | null
          sleep_minutes: number
          switch_count: number
          switches_per_hour: number | null
          task_focus_minutes: number
          tasks_completed: number
          tracked_minutes: number
          untracked_minutes: number
          user_id: string
          waste_minutes: number
          waste_points: number
          waste_share_pct: number | null
        }[]
      }
      get_daily_goal_progress: {
        Args: { p_date: string; p_user_id: string }
        Returns: {
          cumulative_hours: number
          cumulative_minutes: number
          goal_id: string
          goal_minutes: number
          linked_habit_completions: number
          linked_task_count: number
        }[]
      }
      get_daily_habit_status: {
        Args: { p_date: string; p_user_id: string }
        Returns: { completed: boolean; due: boolean; habit_id: string; log_count: number }[]
      }
      get_daily_tracked_coverage: {
        Args: { p_date: string; p_user_id: string }
        Returns: { activity_id: string | null; block_index: number }[]
      }
      get_elapsed_blocks: {
        Args: { p_date: string }
        Returns: number
      }
      get_goal_analytics_range: {
        Args: { p_from: string; p_to: string; p_user_id: string }
        Returns: {
          analytics_version: number
          calculated_at: string
          cumulative_hours: number
          cumulative_minutes: number
          date_key: string
          goal_id: string
          goal_minutes: number
          linked_habit_completions: number
          linked_task_count: number
          user_id: string
        }[]
      }
      get_habit_analytics_range: {
        Args: { p_from: string; p_to: string; p_user_id: string }
        Returns: {
          analytics_version: number
          calculated_at: string
          completed: boolean
          date_key: string
          due: boolean
          habit_id: string
          log_count: number
          user_id: string
        }[]
      }
      get_session_covered_blocks: {
        Args: { p_date: string; p_user_id: string }
        Returns: { block_index: number }[]
      }
      get_sleep_activity_ids: {
        Args: { p_user_id: string }
        Returns: { activity_id: string }[]
      }
      get_transition_analytics_range: {
        Args: { p_from: string; p_to: string; p_user_id: string }
        Returns: {
          analytics_version: number
          calculated_at: string
          date_key: string
          from_activity_id: string
          model_version: number
          to_activity_id: string
          transition_count: number
          user_id: string
        }[]
      }
      rebuild_analytics_range: {
        Args: { p_from: string; p_to: string; p_user_id: string }
        Returns: undefined
      }
      recompute_daily_analytics: {
        Args: { p_date: string; p_user_id: string }
        Returns: undefined
      }
      mark_analytics_dirty: {
        Args: { p_date: string; p_reason: string; p_user_id: string }
        Returns: undefined
      }
      mark_activity_dates_dirty: {
        Args: { p_activity_id: string; p_reason: string; p_user_id: string }
        Returns: undefined
      }
      mark_goal_dates_dirty: {
        Args: { p_goal_id: string; p_reason: string; p_user_id: string }
        Returns: undefined
      }
      mark_habit_dates_dirty: {
        Args: { p_habit_id: string; p_reason: string; p_user_id: string }
        Returns: undefined
      }
      process_dirty_analytics: {
        Args: { p_limit?: number }
        Returns: { date_key: string; error_message: string | null; status: string }[]
      }
      // These three are SECURITY DEFINER and revoked from anon/authenticated (only callable by
      // the database owner / pg_cron), but Supabase's type generator lists every function in the
      // exposed schema regardless of grants, so they're included here for accuracy even though
      // no client code calls them.
      process_dirty_analytics_for_user: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: { date_key: string; error_message: string | null; status: string }[]
      }
      drain_all_dirty_analytics: {
        Args: { p_limit_per_user?: number }
        Returns: undefined
      }
      repair_recent_analytics: {
        Args: { p_days?: number }
        Returns: undefined
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
