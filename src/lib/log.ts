export interface CallLogEntry {
  tool: string;
  argsHash: string;
  country: string;
  lockedHit: boolean;
}

/** Logs every tool call: tool, args hash, country, locked_hit (the KPI). */
export async function logCall(env: Env, entry: CallLogEntry): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO request_log (ts, tool, args_hash, country, locked_hit)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(
        new Date().toISOString(),
        entry.tool,
        entry.argsHash,
        entry.country,
        entry.lockedHit ? 1 : 0,
      )
      .run();
    console.log(
      JSON.stringify({
        event: "tool_call",
        tool: entry.tool,
        args_hash: entry.argsHash,
        country: entry.country,
        locked_hit: entry.lockedHit,
      }),
    );
  } catch (e) {
    // Logging must never break a tool response.
    console.error(JSON.stringify({ event: "log_error", message: String(e) }));
  }
}
