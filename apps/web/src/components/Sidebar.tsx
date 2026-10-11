import type { ReactNode } from "react";

interface SidebarProps {
  open: boolean;
  children: ReactNode;
}

export function Sidebar({ open, children }: SidebarProps) {
  return (
    <aside id="sidebar" className={`sidebar ${open ? "is-open" : ""}`} aria-hidden={!open} inert={!open}>
      <div className="sidebar-content">{children}</div>
    </aside>
  );
}

export function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sidebar-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
