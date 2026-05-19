export interface NetsuiteRow {
  source: string;        // always "netsuite"
  month_key: string;     // "YYYY-MM" derived from filename
  financial_row: string; // e.g. "48501 - Partnership Commissions"
  entity_name: string;   // e.g. "24601 Jive"
  amount: number;        // BIGINT cents
}

export interface MarketingLeadsRow {
  source: string;
  channel: string;
  campaign_name: string;
  month_key: string;
  leads_generated: number;
  leads_qualified: number;
  opportunities_created: number;
  closed_won: number;
  pipeline_value: number; // BIGINT cents
}

export interface SalesforceRow {
  opportunity_id: string;
  opportunity_name: string;
  account_name: string;
  created_date: string | null;    // DATE as YYYY-MM-DD
  close_date: string | null;      // DATE as YYYY-MM-DD
  stage: string;
  monthly_mrr: number;            // BIGINT cents
  number_of_locations: number;
  primary_channel: string;
  primary_campaign_source: string;
  lead_source: string;
  opportunity_owner: string;
  opp_type: string;
  created_month: string;          // YYYY-MM derived from created_date
}

// Metadata passed alongside raw rows so parseRows can access period context
export interface RowMeta {
  monthKey: string;
  filename: string;
  sourceName: string;
}

export type FileStatus = 'new' | 'updated' | 'unchanged' | 'invalid';

// Mirrors the ingested_files table row
export interface FileRecord {
  file_path: string;
  file_name: string;
  source_type: string;
  parent_folder: string;
  file_size_bytes: number;
  file_mtime: Date;
  row_count: number;
  status: 'ok' | 'error' | 'skipped';
  notes?: string;
}

export interface ClassifiedFile {
  path: string;
  monthKey: string;
  status: FileStatus;
  // Stat data carried from scanner to avoid a second stat() call in the pipeline
  fileName: string;
  parentFolder: string;
  fileSizeBytes: number;
  fileMtime: Date;
}

export interface IngestResult {
  rows_ingested: number;
  files_processed: number;
  files_skipped: number;
  errors: string[];
}

export interface PreviewResult {
  source: string;
  label: string;
  files_new: number;
  files_updated: number;
  files_unchanged: number;
  periods: string[];
}

export interface SourceDefinition<TRow = NetsuiteRow | MarketingLeadsRow | SalesforceRow> {
  name: string;
  /** Human-readable label shown in logs and the Data Management tab */
  label: string;
  subFolder: string;
  fileExtension: '.xlsx' | '.xls' | '.csv';
  monthFolderPattern: RegExp;
  requiredColumns: string[];
  /** Row index (0-based) to use as the header. Default 0. NetSuite uses 6. */
  headerRowIndex?: number;
  /**
   * When true, the scanner looks for files directly inside subFolder rather
   * than walking YYYYMM sub-directories. Use for single static files like
   * a full-history Salesforce export.
   */
  flatFile?: boolean;
  parseRows(rows: Record<string, string>[], filename: string): TRow[];
}
