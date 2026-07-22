/** Shared tiny helpers (host). */

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function truncate(s: string, n: number): string {
  const t = String(s || "");
  if (t.length <= n) return t;
  return t.slice(0, Math.max(0, n - 1)) + "…";
}
