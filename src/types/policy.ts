import { AutonomyLevel } from './enums.js';

export interface Policy {
  version: string;
  profile: string;
  installed_by: string;
  installed_at: string;
  autonomy_level: AutonomyLevel;
  max_autonomy_level: AutonomyLevel;
  promotion_requires_human_approval: boolean;
  block_ai_attribution: boolean;
  blocked_paths: string[];
  notification_channel: string;
  // Optional — not present in all policy files; defaults to 'block' when absent
  injection_detection?: 'block' | 'warn';
  // Context protection — commands that must run in subagents, not coordinator
  context_protection?: {
    delegate_to_subagent: string[];
    max_bash_output_lines?: number;
  };
}
