import type { Middleware } from './chain.js';

/**
 * Creates a session middleware instance with its own session ID.
 * Each gateway instance gets its own session — no module-level singletons.
 */
export function createSessionMiddleware(): Middleware {
  const sessionId = crypto.randomUUID();

  const middleware: Middleware & { sessionId: string } = Object.assign(
    async (ctx: Parameters<Middleware>[0], next: Parameters<Middleware>[1]) => {
      ctx.session_id = sessionId;
      await next();
    },
    { sessionId }
  );

  return middleware;
}

/**
 * Utility to get the session ID from a session middleware instance.
 */
export function getSessionId(middleware: Middleware): string {
  return (middleware as Middleware & { sessionId: string }).sessionId;
}
