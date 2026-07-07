import { Section } from "./Section";
import { formatMs } from "../format";
import type { AgentJobRow } from "../types";

export function AgentJobsPanel({ agentJobs }: { agentJobs: AgentJobRow[] }) {
  return (
    <Section
      id="panel-agentjobs"
      title="Running Agent Jobs"
      badge={<span className="panel-hint">currently executing only, not scheduled or failed jobs</span>}
      isEmpty={agentJobs.length === 0}
      emptyText="No SQL Agent jobs currently running."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Started</th>
              <th>Session</th>
              <th>CPU</th>
              <th>Logical Reads</th>
              <th>Writes</th>
              <th>Wait</th>
            </tr>
          </thead>
          <tbody>
            {agentJobs.map((job, idx) => (
              <tr key={idx}>
                <td>{job.jobName}</td>
                <td>{new Date(job.startTime).toLocaleString()}</td>
                <td className="num">{job.sessionId ?? "-"}</td>
                <td className="num">{job.cpuTimeMs !== null ? formatMs(job.cpuTimeMs) : "-"}</td>
                <td className="num">{job.logicalReads !== null ? job.logicalReads.toLocaleString() : "-"}</td>
                <td className="num">{job.writes !== null ? job.writes.toLocaleString() : "-"}</td>
                <td>{job.waitType ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
