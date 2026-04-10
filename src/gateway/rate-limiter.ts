import type { GatewayConfig } from '../types/index.js';

export interface LimitExceededError {
  type: 'concurrency' | 'rate';
  serverName: string;
  current: number;
  limit: number;
  message: string;
}

interface ServerState {
  /** Number of calls currently in-flight */
  activeCalls: number;
  /** Timestamps (ms) of calls in the current rate window */
  callTimestamps: number[];
  maxConcurrent: number;
  callsPerMinute: number;
}

const WINDOW_MS = 60_000;

/**
 * In-memory per-server rate limiter and concurrency cap.
 *
 * Concurrency: tracks active in-flight calls. If at the limit, new calls
 * are rejected immediately with a structured error.
 *
 * Rate: sliding window — calls in the last 60 seconds must not exceed the
 * configured calls_per_minute. 0 means unlimited for either dimension.
 *
 * State is kept in a Map keyed by server name. No disk I/O.
 */
export class RateLimiter {
  private state = new Map<string, ServerState>();

  constructor(gatewayConfig?: GatewayConfig) {
    if (!gatewayConfig) return;
    for (const [name, serverCfg] of Object.entries(gatewayConfig.servers)) {
      this.state.set(name, {
        activeCalls: 0,
        callTimestamps: [],
        maxConcurrent: serverCfg.max_concurrent_calls ?? 0,
        callsPerMinute: serverCfg.calls_per_minute ?? 0,
      });
    }
  }

  /**
   * Try to acquire a slot for a call to `serverName`.
   * Returns null on success, or a LimitExceededError if rejected.
   *
   * On success, call `release()` when the downstream call completes.
   */
  tryAcquire(serverName: string): LimitExceededError | null {
    let s = this.state.get(serverName);
    if (!s) {
      // Server not in config — allow through (no limits configured)
      this.state.set(serverName, {
        activeCalls: 0,
        callTimestamps: [],
        maxConcurrent: 0,
        callsPerMinute: 0,
      });
      s = this.state.get(serverName)!;
    }

    // Prune timestamps outside the sliding window before checking rate
    const now = Date.now();
    s.callTimestamps = s.callTimestamps.filter((t) => now - t < WINDOW_MS);

    // Check rate limit
    if (s.callsPerMinute > 0 && s.callTimestamps.length >= s.callsPerMinute) {
      return {
        type: 'rate',
        serverName,
        current: s.callTimestamps.length,
        limit: s.callsPerMinute,
        message: `Rate limit exceeded for server "${serverName}": ${s.callTimestamps.length}/${s.callsPerMinute} calls in the last 60s`,
      };
    }

    // Check concurrency limit
    if (s.maxConcurrent > 0 && s.activeCalls >= s.maxConcurrent) {
      return {
        type: 'concurrency',
        serverName,
        current: s.activeCalls,
        limit: s.maxConcurrent,
        message: `Concurrency limit exceeded for server "${serverName}": ${s.activeCalls}/${s.maxConcurrent} active calls`,
      };
    }

    // Acquire
    s.activeCalls++;
    s.callTimestamps.push(now);
    return null;
  }

  /**
   * Release a previously acquired concurrency slot.
   * Safe to call even if `serverName` is unknown — no-op.
   */
  release(serverName: string): void {
    const s = this.state.get(serverName);
    if (!s) return;
    if (s.activeCalls > 0) s.activeCalls--;
  }

  /** Expose state for testing */
  getState(serverName: string): ServerState | undefined {
    return this.state.get(serverName);
  }
}
