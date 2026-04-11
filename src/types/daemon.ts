/**
 * Daemon configuration loaded from ~/.reagent/daemon.yaml.
 *
 * The Node.js supervisor does not require a network port or session registry.
 * It only needs to know what binary to supervise and at what log level.
 */
export interface DaemonConfig {
  /**
   * Path to the reagent binary (or dist/cli/index.js) to supervise.
   * Defaults to the dist/cli/index.js entry-point relative to the package.
   */
  reagent_bin?: string;
  /** Log verbosity forwarded to the supervised process. Default: 'info' */
  log_level: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Shape of ~/.reagent/daemon-health.json written by the supervisor every 30s.
 *
 * `reagent daemon status` reads this file — no HTTP endpoint required.
 */
export interface DaemonHealthFile {
  version: string;
  pid: number;
  started_at: string;
  restarts: number;
  last_restart_at: string | null;
}
