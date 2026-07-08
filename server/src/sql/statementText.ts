// sys.dm_exec_sql_text(sql_handle) returns the FULL batch or stored procedure body, not just the
// statement that's actually running - dumping that verbatim as "query text" means a session
// currently inside even a modest stored procedure reports that procedure's entire (often
// hundreds-of-lines) source as its "query". This fragment instead resolves the procedure name
// when the batch is running inside one (OBJECT_NAME), so callers can show "EXEC dbo.Proc" instead
// of the proc body, and for ad-hoc batches slices out just the one statement at
// [statement_start_offset, statement_end_offset) - the standard "currently executing statement"
// idiom - instead of the whole (possibly multi-statement) batch text. Requires `r` (a
// sys.dm_exec_requests alias with statement offsets) and `qt` (an OUTER APPLY sys.dm_exec_sql_text
// alias) in scope; see consumers.ts / blocking.ts / longOps.ts for usage.
export const CURRENT_STATEMENT_SELECT = `
      OBJECT_NAME(qt.objectid, qt.dbid) AS proc_name,
      SUBSTRING(
        qt.text,
        (r.statement_start_offset / 2) + 1,
        ((CASE r.statement_end_offset WHEN -1 THEN DATALENGTH(qt.text) ELSE r.statement_end_offset END
          - r.statement_start_offset) / 2) + 1
      ) AS statement_text`;

// Prefer naming the procedure over dumping its body; only fall back to the (already
// statement-scoped, not whole-batch) text for ad-hoc SQL.
export function formatQueryText(procName: string | null, statementText: string | null): string | null {
  return procName ? `EXEC ${procName}` : statementText;
}
