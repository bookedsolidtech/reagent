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
}
