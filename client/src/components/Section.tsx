import { ReactNode } from "react";

export function Section({
  title,
  isEmpty,
  emptyText,
  children,
  badge,
}: {
  title: string;
  isEmpty: boolean;
  emptyText: string;
  children: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <section className={`panel ${isEmpty ? "" : "panel-flagged"}`}>
      <div className="panel-header">
        <h2>{title}</h2>
        {badge}
      </div>
      {isEmpty ? <div className="empty-panel">{emptyText}</div> : children}
    </section>
  );
}
