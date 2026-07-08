// Plain-English explanations for SQL Server wait types, shown as a hover tooltip wherever a raw
// wait type name (e.g. "PAGEIOLATCH_SH", "LCK_M_X") appears — the name alone means little to
// anyone who isn't already fluent in SQL Server internals. Exact matches for the wait types that
// actually show up in this app's own diagnosis thresholds and everyday incidents; a prefix table
// covers the rest of each wait "family," and anything still unrecognized gets a generic fallback
// rather than being left unexplained.
const EXACT: Record<string, string> = {
  CXPACKET:
    "Parallel query coordination — one thread of a parallel query waiting on the others. Common on multi-core servers; only a real problem if excessive relative to actual CPU work done.",
  CXCONSUMER: "Same as CXPACKET (parallel query coordination), the name used since SQL Server 2016.",
  SOS_SCHEDULER_YIELD:
    "The task voluntarily gave up the CPU (cooperative scheduling) and is waiting for its turn again. High values usually point to CPU pressure.",
  THREADPOOL:
    "Waiting for a free worker thread — SQL Server has run out of available workers. Often serious; see the Pressure panel's worker/scheduler stats.",
  RESOURCE_SEMAPHORE:
    "Waiting for a query memory grant (workspace memory for sorts/hashes/joins) — other queries are holding the memory this one needs.",
  WRITELOG:
    "Waiting for the transaction log to flush to disk. High values point to slow log disk I/O or too many small transactions.",
  PAGEIOLATCH_SH:
    "Waiting to read a data page from disk into the buffer pool (shared access). High values point to slow storage or an undersized buffer pool.",
  PAGEIOLATCH_EX:
    "Waiting to read/write a data page from disk into the buffer pool (exclusive access). High values point to slow storage.",
  PAGELATCH_SH:
    "Waiting on an in-memory page latch (shared) — not a disk wait. Frequently tempdb allocation-page contention (GAM/SGAM/PFS pages).",
  PAGELATCH_EX:
    "Waiting on an in-memory page latch (exclusive) — not a disk wait. Frequently tempdb allocation-page contention under heavy temp table/table variable use.",
  ASYNC_NETWORK_IO:
    "Waiting for the client application to consume results SQL Server already produced — usually a slow client or network, not a slow query.",
  BACKUPIO: "Waiting on backup device I/O (reading source data or writing to the backup destination) during a backup.",
  BACKUPBUFFER: "Waiting on an internal backup buffer during a backup or restore.",
  OLEDB: "Waiting on a linked server / OLE DB provider call.",
  CMEMTHREAD:
    "Waiting for access to a memory allocator shared across threads — can indicate compilation or plan-cache pressure.",
  IO_COMPLETION: "Waiting on non-data-page file I/O (e.g. reading a file other than a data file).",
  WAITFOR: "The query explicitly called WAITFOR DELAY/TIME — not a symptom of a problem.",
};

const PREFIX: [string, string][] = [
  [
    "LCK_M_",
    "Waiting to acquire a lock held by another session — this is classic blocking. Check the Blocking tab to see who's holding it.",
  ],
  ["PAGEIOLATCH_", "Waiting on a data page disk I/O. High values point to slow storage or an undersized buffer pool."],
  ["PAGELATCH_", "Waiting on an in-memory page latch, not disk I/O — often tempdb allocation contention."],
  ["LATCH_", "Waiting on an internal latch protecting an in-memory structure (not a lock, not necessarily disk-related)."],
  ["SLEEP_", "The task is intentionally sleeping for internal housekeeping — usually benign."],
  ["LOG_", "Waiting on transaction log activity (writing or synchronizing log records)."],
  [
    "PREEMPTIVE_",
    "Waiting on a call out to code outside the SQL Server engine (e.g. the OS, a CLR call, an extended stored procedure).",
  ],
  ["DBMIRROR_", "Waiting on database mirroring synchronization."],
  ["HADR_", "Waiting on Always On Availability Group synchronization."],
  ["XE_", "Internal Extended Events session activity — usually benign."],
];

export function describeWaitType(waitType: string | null | undefined): string | null {
  if (!waitType) return null;
  const exact = EXACT[waitType];
  if (exact) return exact;
  const prefixMatch = PREFIX.find(([prefix]) => waitType.startsWith(prefix));
  if (prefixMatch) return prefixMatch[1];
  return "SQL Server internal wait type — not one of the common ones this app explains. Search Microsoft's sys.dm_os_wait_stats documentation for details.";
}
