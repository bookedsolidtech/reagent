import { z } from 'zod';

export const TaskEventSchema = z.object({
  id: z.string().regex(/^T-\d+$/, 'Task ID must be T-NNN format'),
  type: z.enum(['created', 'started', 'completed', 'blocked', 'cancelled']),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  urgency: z.enum(['critical', 'normal', 'low']).optional().default('normal'),
  phase: z.string().optional(),
  milestone: z.string().optional(),
  assignee: z.string().optional(),
  parent_id: z
    .string()
    .regex(/^T-\d+$/)
    .optional(),
  commit_refs: z.array(z.string()).optional(),
  pr_ref: z.string().optional(),
  blocked_by: z.string().optional(),
  github_issue: z.number().int().positive().optional(),
  timestamp: z.string().datetime(),
  session_id: z.string().optional(),
});

export type TaskEvent = z.infer<typeof TaskEventSchema>;
export type TaskEventInput = z.input<typeof TaskEventSchema>;

export interface TaskView {
  id: string;
  title: string;
  status: 'created' | 'started' | 'completed' | 'blocked' | 'cancelled';
  urgency: 'critical' | 'normal' | 'low';
  description?: string;
  phase?: string;
  milestone?: string;
  assignee?: string;
  parent_id?: string;
  commit_refs?: string[];
  pr_ref?: string;
  blocked_by?: string;
  github_issue?: number;
  created_at: string;
  updated_at: string;
}
