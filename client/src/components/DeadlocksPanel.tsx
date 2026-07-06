import { Section } from "./Section";
import type { DeadlockEvent } from "../types";

export function DeadlocksPanel({ deadlocks }: { deadlocks: DeadlockEvent[] }) {
  return (
    <Section title="Recent Deadlocks" isEmpty={deadlocks.length === 0} emptyText="No deadlocks recorded recently.">
      <div className="deadlock-list">
        {deadlocks.map((d, idx) => (
          <details className="deadlock-item" key={idx}>
            <summary>{new Date(d.timestamp).toLocaleString()}</summary>
            <pre className="deadlock-xml">{d.xml}</pre>
          </details>
        ))}
      </div>
    </Section>
  );
}
