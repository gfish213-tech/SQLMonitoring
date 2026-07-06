import { ReactNode } from "react";

export function Section({
  id,
  title,
  isEmpty,
  emptyText,
  children,
  badge,
}: {
  id?: string;
  title: string;
  isEmpty: boolean;
  emptyText: string;
  children: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <section id={id} className={`panel ${isEmpty ? "" : "panel-flagged"}`}>
      <div className="panel-header">
        <h2>{title}</h2>
        {badge}
      </div>
      {isEmpty ? <div className="empty-panel">{emptyText}</div> : children}
    </section>
  );
}
