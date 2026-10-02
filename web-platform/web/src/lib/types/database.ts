// Hand-written to match supabase/migrations/*.sql exactly. If the schema
// changes, update this file in the same commit (or regenerate with
// `supabase gen types typescript` once the project is linked).

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type UserRole = "super_admin" | "project_admin" | "tpm_supervisor" | "dri" | "viewer" | "state_coordinator";
export type AccountStatus = "active" | "inactive";
export type IssueStatus =
  | "new"
  | "pending_review"
  | "returned_for_correction"
  | "assigned"
  | "in_progress"
  | "resolved"
  | "verified_closed"
  | "reopened";
export type IssuePriority = "critical" | "high" | "medium" | "low";
export type DatasetStatus = "approved" | "pending_create" | "pending_update" | "pending_delete" | "rejected";
export type DownloadRequestStatus = "pending" | "approved" | "rejected" | "fulfilled";
export type FacilityType = "state_store" | "lga_store" | "health_facility";
export type TxnType =
  | "receipt"
  | "issue"
  | "dispensed"
  | "loss_damaged"
  | "loss_expired"
  | "loss_other"
  | "adjustment"
  | "physical_count";
export type TransferStatus = "in_transit" | "received" | "discrepancy";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string;
          email: string;
          phone: string | null;
          role: UserRole;
          project_id: string | null;
          status: AccountStatus;
          last_login: string | null;
          created_at: string;
          updated_at: string;
          // Only meaningful for role = state_coordinator — see migration 0031/DECISIONS.md #22.
          managed_state_id: string | null;
          // Only meaningful for role = dri — see migration 0031/DECISIONS.md #22.
          assigned_category_id: string | null;
          // The one facility a dri records for (migration 0100); sets assigned_category_id to its level.
          facility_id: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & { id: string; name: string; email: string };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      projects: {
        Row: { id: string; name: string; created_at: string };
        Insert: { id?: string; name: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["projects"]["Row"]>;
        Relationships: [];
      };
      states: {
        Row: {
          id: string;
          code: string | null;
          name: string;
          geozone: string | null;
          capital: string | null;
          created_at: string;
          // geom/geom_simplified (PostGIS) are fetched as GeoJSON via RPCs
          // (see lib/queries/boundaries.ts), not selected as raw columns.
        };
        Insert: { id?: string; code?: string | null; name: string; geozone?: string | null; capital?: string | null };
        Update: Partial<Database["public"]["Tables"]["states"]["Row"]>;
        Relationships: [];
      };
      lgas: {
        Row: { id: string; state_id: string; code: string | null; name: string; created_at: string };
        Insert: { id?: string; state_id: string; code?: string | null; name: string };
        Update: Partial<Database["public"]["Tables"]["lgas"]["Row"]>;
        Relationships: [];
      };
      wards: {
        Row: {
          id: string;
          lga_id: string;
          code: string | null;
          name: string;
          urban: boolean | null;
          created_at: string;
        };
        Insert: { id?: string; lga_id: string; code?: string | null; name: string; urban?: boolean | null };
        Update: Partial<Database["public"]["Tables"]["wards"]["Row"]>;
        Relationships: [];
      };
      categories: {
        // is_active: false for a legacy category kept only because existing Findings still
        // reference it — see migration 0031/0032 and DECISIONS.md #22 (Category → Sector).
        Row: { id: string; name: string; sort_order: number; abbr: string; is_active: boolean };
        Insert: { id?: string; name: string; sort_order?: number; abbr: string; is_active?: boolean };
        Update: Partial<Database["public"]["Tables"]["categories"]["Row"]>;
        Relationships: [];
      };
      issues: {
        Row: {
          id: string;
          issue_number: number;
          code: string;
          project_id: string | null;
          category_id: string;
          description: string;
          state_id: string;
          lga_id: string;
          ward_id: string | null;
          ward: string | null;
          settlement_id: string | null;
          settlement: string | null;
          activity_site_id: string | null;
          activity_site: string | null;
          location_other: string | null;
          mobile_code: string | null;
          lat: number | null;
          lng: number | null;
          reported_at: string;
          reported_by: string | null;
          priority: IssuePriority;
          status: IssueStatus;
          assigned_dri: string | null;
          dri_response: string | null;
          corrective_action: string | null;
          verified_by: string | null;
          resolution_date: string | null;
          photo_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id?: string | null;
          category_id: string;
          description: string;
          state_id: string;
          lga_id: string;
          ward_id?: string | null;
          ward?: string | null;
          settlement_id?: string | null;
          settlement?: string | null;
          activity_site_id?: string | null;
          activity_site?: string | null;
          location_other?: string | null;
          mobile_code?: string | null;
          lat?: number | null;
          lng?: number | null;
          reported_at?: string;
          reported_by?: string | null;
          priority?: IssuePriority;
          status?: IssueStatus;
        };
        Update: Partial<Database["public"]["Tables"]["issues"]["Row"]>;
        Relationships: [];
      };
      issue_history: {
        Row: {
          id: string;
          issue_id: string;
          occurred_at: string;
          actor_id: string | null;
          actor_label: string;
          // Who was acting *as* which role at the time — added (migration 0040) once a review/
          // approval action could legitimately come from more than one role. Null on every row
          // written before that migration; never backfilled.
          actor_role: UserRole | null;
          action: string;
          note: string | null;
        };
        Insert: {
          id?: string;
          issue_id: string;
          actor_id?: string | null;
          actor_label: string;
          actor_role?: UserRole | null;
          action: string;
          note?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["issue_history"]["Row"]>;
        Relationships: [];
      };
      issue_photos: {
        Row: {
          id: string;
          issue_id: string;
          storage_path: string;
          file_name: string | null;
          mime_type: string | null;
          size_bytes: number | null;
          uploaded_by: string | null;
          uploaded_at: string;
        };
        Insert: {
          id?: string;
          issue_id: string;
          storage_path: string;
          file_name?: string | null;
          mime_type?: string | null;
          size_bytes?: number | null;
          uploaded_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["issue_photos"]["Row"]>;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          text: string;
          link: string | null;
          issue_id: string | null;
          read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: string;
          text: string;
          link?: string | null;
          issue_id?: string | null;
          read?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Row"]>;
        Relationships: [];
      };
      download_requests: {
        Row: {
          id: string;
          requester_id: string;
          project_id: string | null;
          resource_type: string;
          format: string;
          filters: Json;
          reason: string | null;
          status: DownloadRequestStatus;
          reviewed_by: string | null;
          reviewed_at: string | null;
          review_note: string | null;
          download_token: string | null;
          fulfilled_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          requester_id: string;
          project_id?: string | null;
          resource_type: string;
          format: string;
          filters?: Json;
          reason?: string | null;
          status?: DownloadRequestStatus;
        };
        Update: Partial<Database["public"]["Tables"]["download_requests"]["Row"]>;
        Relationships: [];
      };
      settlements: {
        Row: {
          id: string;
          ward_id: string;
          statename: string;
          lganame: string;
          settlementname: string;
          project_id: string | null;
          status: DatasetStatus;
          pending_data: { settlementname?: string } | null;
          submitted_by: string | null;
          reviewed_by: string | null;
          review_note: string | null;
          created_at: string;
          updated_at: string;
        };
        // statename/lganame are server-derived from ward_id (see migration 0019) — never sent by the client.
        Insert: { id?: string; ward_id: string; settlementname: string; project_id?: string | null };
        Update: Partial<Database["public"]["Tables"]["settlements"]["Row"]>;
        Relationships: [];
      };
      activity_sites: {
        Row: {
          id: string;
          ward_id: string;
          statename: string;
          lganame: string;
          activitysitename: string;
          project_id: string | null;
          status: DatasetStatus;
          pending_data: { activitysitename?: string } | null;
          submitted_by: string | null;
          reviewed_by: string | null;
          review_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: { id?: string; ward_id: string; activitysitename: string; project_id?: string | null };
        Update: Partial<Database["public"]["Tables"]["activity_sites"]["Row"]>;
        Relationships: [];
      };
      facilities: {
        // state_id, ward_id (when blank) and location_flag are derived server-side by
        // derive_facility_location() (migration 0100) — never trusted from the client.
        Row: {
          id: string;
          project_id: string | null;
          facility_type: FacilityType;
          name: string;
          national_code: string | null;
          state_id: string;
          lga_id: string;
          ward_id: string | null;
          ward_name_source: string | null;
          lat: number | null;
          lng: number | null;
          geocode_accuracy_m: number | null;
          geocode_source: "field_gps" | "registry" | "manual" | null;
          location_flag: string | null;
          is_otp_site: boolean;
          supplied_by_facility_id: string | null;
          is_hard_to_reach: boolean;
          is_active: boolean;
          functional_status: string | null;
          registry_category: string | null;
          dummy_fields: string | null;
          status: DatasetStatus;
          pending_data: Json | null;
          submitted_by: string | null;
          reviewed_by: string | null;
          review_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Omit<Database["public"]["Tables"]["facilities"]["Row"], "state_id">> & {
          facility_type: FacilityType;
          name: string;
          lga_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["facilities"]["Row"]>;
        Relationships: [];
      };
      products: {
        Row: { id: string; name: string; unit: string; units_per_carton: number; shelf_life_months: number | null; created_at: string; updated_at: string };
        Insert: { id?: string; name: string; unit?: string; units_per_carton: number; shelf_life_months?: number | null };
        Update: Partial<Database["public"]["Tables"]["products"]["Row"]>;
        Relationships: [];
      };
      product_lots: {
        Row: { id: string; product_id: string; lot_no: string; expiry_date: string; created_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; product_id: string; lot_no: string; expiry_date: string };
        Update: Partial<Database["public"]["Tables"]["product_lots"]["Row"]>;
        Relationships: [];
      };
      protocol_rules: {
        Row: {
          id: string;
          protocol_version: string;
          weight_min_kg: number;
          weight_max_kg: number;
          sachets_per_week: number;
          effective_from: string;
          effective_to: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          protocol_version: string;
          weight_min_kg: number;
          weight_max_kg: number;
          sachets_per_week: number;
          effective_from: string;
          effective_to?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["protocol_rules"]["Row"]>;
        Relationships: [];
      };
      rutf_thresholds: {
        Row: { project_id: string; key: string; value: number; note: string | null; updated_at: string };
        Insert: { project_id: string; key: string; value: number; note?: string | null };
        Update: Partial<Database["public"]["Tables"]["rutf_thresholds"]["Row"]>;
        Relationships: [];
      };
      transfers: {
        // Written only by record_issue / record_receipt (migration 0101).
        Row: {
          id: string;
          project_id: string | null;
          code: string | null;
          from_facility_id: string;
          to_facility_id: string;
          issued_date: string;
          received_date: string | null;
          sachets_issued: number;
          sachets_received: number | null;
          status: TransferStatus;
          document_no: string | null;
          issued_by: string | null;
          received_by: string | null;
          local_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      stock_transactions: {
        // Written only by the record_* functions (migration 0101); never updated or deleted.
        Row: {
          id: string;
          project_id: string | null;
          facility_id: string;
          txn_type: TxnType;
          txn_date: string;
          lot_id: string | null;
          lot_no_seen: string | null;
          expiry_seen: string | null;
          quantity_sachets: number;
          counterparty_facility_id: string | null;
          transfer_id: string | null;
          document_no: string | null;
          reason: string | null;
          recorded_by: string;
          device_id: string | null;
          local_id: string | null;
          submission_local_id: string | null;
          status: "recorded" | "confirmed" | "voided";
          confirmed_by: string | null;
          confirmed_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      otp_daily_dispensing: {
        Row: {
          id: string;
          project_id: string | null;
          facility_id: string;
          dispense_date: string;
          new_admissions: number;
          children_seen: number;
          sachets_prescribed: number;
          sachets_dispensed: number;
          recorded_by: string;
          device_id: string | null;
          local_id: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      ledger_photos: {
        Row: {
          id: string;
          submission_local_id: string;
          facility_id: string;
          storage_path: string;
          kind: "waybill" | "stock_card" | "register_page" | "loss_evidence" | "other";
          mime_type: string | null;
          size_bytes: number | null;
          uploaded_by: string | null;
          uploaded_at: string;
        };
        Insert: {
          submission_local_id: string;
          facility_id: string;
          storage_path: string;
          kind: Database["public"]["Tables"]["ledger_photos"]["Row"]["kind"];
          mime_type?: string | null;
          size_bytes?: number | null;
        };
        Update: never;
        Relationships: [];
      };
      settings: {
        Row: {
          id: number;
          org_name: string;
          timezone: string;
          default_state_id: string | null;
          email_alerts_on: boolean;
          sms_alerts_on: boolean;
          auto_assign_by_ward: boolean;
          data_retention: string;
          export_format: string;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["settings"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["settings"]["Row"]>;
        Relationships: [];
      };
      field_monitor_attendance: {
        // state_id/lga_id/project_id are resolved server-side (trigger, migration 0037) — never
        // sent by the client.
        Row: {
          id: string;
          field_monitor_id: string;
          project_id: string | null;
          attendance_date: string;
          captured_at: string;
          lat: number;
          lng: number;
          gps_accuracy_m: number | null;
          state_id: string | null;
          lga_id: string | null;
          selfie_storage_path: string;
          assignment_location_storage_path: string;
          device_id: string;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          field_monitor_id: string;
          attendance_date: string;
          captured_at: string;
          lat: number;
          lng: number;
          gps_accuracy_m?: number | null;
          selfie_storage_path: string;
          assignment_location_storage_path: string;
          device_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["field_monitor_attendance"]["Row"]>;
        Relationships: [];
      };
    };
    Views: {
      // Migration 0101 — security_invoker views, so the caller's RLS applies.
      stock_balances: {
        Row: {
          facility_id: string;
          lot_id: string | null;
          lot_no: string | null;
          expiry_date: string | null;
          balance: number;
          last_txn_date: string;
        };
        Relationships: [];
      };
      transfer_overview: {
        Row: Database["public"]["Tables"]["transfers"]["Row"] & { gap: number; days_in_transit: number | null };
        Relationships: [];
      };
    };
    Functions: {
      get_dashboard_stats: {
        Args: Record<string, never>;
        Returns: Json;
      };
      get_time_efficiency_stats: {
        Args: Record<string, never>;
        Returns: Json;
      };
      assign_issue: {
        Args: { p_issue_id: string; p_dri_id: string; p_note?: string | null };
        Returns: Database["public"]["Tables"]["issues"]["Row"];
      };
      submit_dri_response: {
        Args: { p_issue_id: string; p_response: string; p_note?: string | null };
        Returns: Database["public"]["Tables"]["issues"]["Row"];
      };
      record_corrective_action: {
        Args: { p_issue_id: string; p_action_taken: string; p_note?: string | null };
        Returns: Database["public"]["Tables"]["issues"]["Row"];
      };
      verify_and_close_issue: {
        Args: { p_issue_id: string; p_note?: string | null };
        Returns: Database["public"]["Tables"]["issues"]["Row"];
      };
      edit_issue_submission: {
        Args: { p_issue_id: string; p_category_id: string; p_priority: IssuePriority; p_description: string };
        Returns: Database["public"]["Tables"]["issues"]["Row"];
      };
      approve_and_assign_finding: {
        Args: { p_issue_id: string; p_dri_id: string; p_note?: string | null };
        Returns: Database["public"]["Tables"]["issues"]["Row"];
      };
      return_finding_for_correction: {
        Args: { p_issue_id: string; p_comment: string };
        Returns: Database["public"]["Tables"]["issues"]["Row"];
      };
      delete_issue_submission: {
        Args: { p_issue_id: string };
        Returns: void;
      };
      get_state_boundaries: {
        Args: Record<string, never>;
        Returns: { id: string; name: string; code: string | null; geojson: GeoJSON.Geometry }[];
      };
      get_lga_boundaries: {
        Args: { p_state_id?: string | null };
        Returns: { id: string; state_id: string; name: string; code: string | null; geojson: GeoJSON.Geometry }[];
      };
      get_ward_boundaries: {
        Args: { p_lga_id: string };
        Returns: { id: string; lga_id: string; name: string; code: string | null; geojson: GeoJSON.Geometry }[];
      };
      approve_settlement: {
        Args: { p_id: string; p_note?: string | null };
        Returns: Database["public"]["Tables"]["settlements"]["Row"];
      };
      reject_settlement: {
        Args: { p_id: string; p_note: string };
        Returns: Database["public"]["Tables"]["settlements"]["Row"];
      };
      approve_activity_site: {
        Args: { p_id: string; p_note?: string | null };
        Returns: Database["public"]["Tables"]["activity_sites"]["Row"];
      };
      reject_activity_site: {
        Args: { p_id: string; p_note: string };
        Returns: Database["public"]["Tables"]["activity_sites"]["Row"];
      };
      approve_facility: {
        Args: { p_id: string; p_note?: string | null };
        Returns: Database["public"]["Tables"]["facilities"]["Row"];
      };
      reject_facility: {
        Args: { p_id: string; p_note: string };
        Returns: Database["public"]["Tables"]["facilities"]["Row"];
      };
      resolve_administrative_location: {
        Args: { p_lat: number; p_lng: number };
        Returns: {
          state_id: string | null;
          state_name: string | null;
          lga_id: string | null;
          lga_name: string | null;
          ward_id: string | null;
          ward_name: string | null;
        }[];
      };
      create_download_request: {
        Args: { p_resource_type: string; p_format: string; p_filters: Json; p_reason?: string | null };
        Returns: Database["public"]["Tables"]["download_requests"]["Row"];
      };
      decide_download_request: {
        Args: { p_request_id: string; p_approve: boolean; p_note?: string | null };
        Returns: Database["public"]["Tables"]["download_requests"]["Row"];
      };
      fulfill_download_request: {
        Args: { p_request_id: string; p_token: string };
        Returns: void;
      };
    };
    Enums: {
      user_role: UserRole;
      account_status: AccountStatus;
      issue_status: IssueStatus;
      issue_priority: IssuePriority;
      dataset_status: DatasetStatus;
      download_request_status: DownloadRequestStatus;
      facility_type: FacilityType;
      txn_type: TxnType;
    };
  };
}
