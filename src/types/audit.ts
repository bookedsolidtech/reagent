import { Tier, InvocationStatus } from './enums.js';

export interface AuditRecord {
  timestamp: string;
  session_id: string;
  tool_name: string;
  server_name: string;
  tier: Tier;
  status: InvocationStatus;
  autonomy_level: string;
  duration_ms: number;
  account_name?: string;
  error?: string;
  redacted_fields?: string[];
  hash: string;
  prev_hash: string;
}
