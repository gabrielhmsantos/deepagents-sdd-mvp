import { useState } from "react";
import { AdminProjectsTable } from "./AdminProjectsTable";
import { IntegrationCard } from "./IntegrationCard";

interface Props {
  onProjectsChanged: () => void;
}

type Tab = "integrations" | "admin";

const s = {
  text: "#e2e8f0",
  muted: "#64748b",
  border: "#1e293b",
  purple: "#7c3aed",
};

export function SettingsView({ onProjectsChanged }: Props) {
  const [tab, setTab] = useState<Tab>("integrations");

  return (
    <div
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontSize: "1.4rem",
            fontWeight: 700,
            color: s.text,
            letterSpacing: "-0.01em",
          }}
        >
          Configurações
        </h1>
        <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: s.muted }}>
          Integrações globais e administração de projetos.
        </p>
      </div>

      {/* Tab bar */}
      <div
        role="tablist"
        style={{
          display: "flex",
          gap: "0.25rem",
          borderBottom: `1px solid ${s.border}`,
        }}
      >
        <TabButton active={tab === "integrations"} onClick={() => setTab("integrations")}>
          Integrações
        </TabButton>
        <TabButton active={tab === "admin"} onClick={() => setTab("admin")}>
          Admin: Projetos
        </TabButton>
      </div>

      {/* Tab content */}
      <div style={{ minHeight: 200 }}>
        {tab === "integrations" && <IntegrationCard />}
        {tab === "admin" && <AdminProjectsTable onProjectsChanged={onProjectsChanged} />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        borderBottom: `2px solid ${active ? s.purple : "transparent"}`,
        color: active ? s.text : s.muted,
        padding: "0.5rem 0.85rem",
        fontSize: "0.85rem",
        fontWeight: 600,
        cursor: "pointer",
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}
