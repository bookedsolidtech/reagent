export type ProjectType =
  | 'astro'
  | 'nextjs'
  | 'drupal'
  | 'lit-wc'
  | 'react'
  | 'node-api'
  | 'monorepo'
  | 'unknown';

export interface StackAnalysis {
  projectName: string;
  projectVersion: string;
  targetDir: string;
  detectedTypes: ProjectType[];
  framework: string | null;
  testRunner: string | null;
  installedHooks: string[];
  testFiles: string[];
  autonomyLevel: string | null;
  profile: string | null;
  hasOpenApi: boolean;
  hasCustomElements: boolean;
  hasShadowDom: boolean;
}

export type GapSeverity = 'critical' | 'high' | 'normal';
export type GapCategory = 'hook' | 'gate' | 'agent' | 'test';

export interface Gap {
  id: string;
  severity: GapSeverity;
  category: GapCategory;
  title: string;
  description: string;
  suggestion?: string;
  projectTypes?: ProjectType[];
}

export interface GapAnalysis {
  stack: StackAnalysis;
  gaps: Gap[];
  totalRecommendedHooks: number;
  installedHookCount: number;
  totalRecommendedGates: number;
}

export interface CatalyzeReportOptions {
  analysis: GapAnalysis;
  generatedAt: string;
  outputDir: string;
}
