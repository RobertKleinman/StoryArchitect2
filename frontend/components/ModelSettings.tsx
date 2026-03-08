import React, { useState, useEffect, useCallback } from "react";

// ── Types matching shared/modelConfig.ts ─────────────────

interface ProviderModelEntry {
  id: string;
  label: string;
  provider: string;
  tier: string;
}

interface ModelConfig {
  [role: string]: string;
}

// ── Role groupings for the UI ────────────────────────────

const ROLE_GROUPS: { label: string; roles: { key: string; label: string }[] }[] = [
  {
    label: "Hook Module",
    roles: [
      { key: "clarifier", label: "Clarifier" },
      { key: "builder", label: "Builder" },
      { key: "judge", label: "Judge" },
      { key: "polish", label: "Polish" },
      { key: "summary", label: "Summary" },
    ],
  },
  {
    label: "Character Module",
    roles: [
      { key: "char_clarifier", label: "Clarifier" },
      { key: "char_builder", label: "Builder" },
      { key: "char_judge", label: "Judge" },
      { key: "char_polish", label: "Polish" },
      { key: "char_summary", label: "Summary" },
    ],
  },
  {
    label: "Character Image Module",
    roles: [
      { key: "img_clarifier", label: "Clarifier" },
      { key: "img_builder", label: "Builder" },
      { key: "img_judge", label: "Judge" },
      { key: "img_summary", label: "Summary" },
    ],
  },
  {
    label: "World Module",
    roles: [
      { key: "world_clarifier", label: "Clarifier" },
      { key: "world_builder", label: "Builder" },
      { key: "world_judge", label: "Judge" },
      { key: "world_polish", label: "Polish" },
      { key: "world_summary", label: "Summary" },
    ],
  },
];

// ── Component ────────────────────────────────────────────

export function ModelSettings({ onClose }: { onClose: () => void }) {
  const [models, setModels] = useState<ProviderModelEntry[]>([]);
  const [config, setConfig] = useState<ModelConfig>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [globalModel, setGlobalModel] = useState<string>("");

  // Fetch current config + available models
  useEffect(() => {
    Promise.all([
      fetch("/api/models").then((r) => r.json()),
      fetch("/api/models/available").then((r) => r.json()),
    ])
      .then(([cfg, avail]) => {
        setConfig(cfg);
        setModels(avail.models);
        // Detect if all roles use the same model
        const vals = Object.values(cfg) as string[];
        if (vals.length > 0 && vals.every((v) => v === vals[0])) {
          setGlobalModel(vals[0]);
        }
      })
      .catch((err) => setError(`Failed to load: ${err.message}`));
  }, []);

  // Set all roles to one model
  const applyGlobal = useCallback(
    (modelId: string) => {
      setGlobalModel(modelId);
      if (!modelId) return;
      const next: ModelConfig = {};
      for (const group of ROLE_GROUPS) {
        for (const role of group.roles) {
          next[role.key] = modelId;
        }
      }
      setConfig(next);
    },
    [],
  );

  // Set one role
  const setRole = useCallback((key: string, modelId: string) => {
    setGlobalModel(""); // No longer "all same"
    setConfig((prev) => ({ ...prev, [key]: modelId }));
  }, []);

  // Save
  const save = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/models", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Save failed");
      } else {
        setConfig(data);
        setSuccess("Saved! New LLM calls will use these models.");
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Group models by provider for the <optgroup> tags
  const byProvider: Record<string, ProviderModelEntry[]> = {};
  for (const m of models) {
    (byProvider[m.provider] ??= []).push(m);
  }

  const providerLabels: Record<string, string> = {
    anthropic: "Anthropic (Claude)",
    openai: "OpenAI (ChatGPT)",
    grok: "xAI (Grok)",
    gemini: "Google (Gemini)",
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Model Settings</h2>
          <button type="button" onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        {error && <div style={styles.error}>{error}</div>}
        {success && <div style={styles.success}>{success}</div>}

        {/* Global selector */}
        <div style={styles.globalRow}>
          <label style={styles.globalLabel}>Set all roles to:</label>
          <select
            style={styles.select}
            value={globalModel}
            onChange={(e) => applyGlobal(e.target.value)}
          >
            <option value="">— Per-role (custom) —</option>
            {Object.entries(byProvider).map(([prov, ms]) => (
              <optgroup key={prov} label={providerLabels[prov] || prov}>
                {ms.map((m) => (
                  <option key={m.id} value={m.id}>{m.label} ({m.tier})</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Per-role selectors */}
        <div style={styles.groups}>
          {ROLE_GROUPS.map((group) => (
            <div key={group.label} style={styles.group}>
              <h3 style={styles.groupTitle}>{group.label}</h3>
              {group.roles.map((role) => (
                <div key={role.key} style={styles.roleRow}>
                  <span style={styles.roleLabel}>{role.label}</span>
                  <select
                    style={styles.selectSmall}
                    value={config[role.key] || ""}
                    onChange={(e) => setRole(role.key, e.target.value)}
                  >
                    {Object.entries(byProvider).map(([prov, ms]) => (
                      <optgroup key={prov} label={providerLabels[prov] || prov}>
                        {ms.map((m) => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={styles.footer}>
          <button type="button" onClick={onClose} style={styles.cancelBtn}>Cancel</button>
          <button type="button" onClick={save} disabled={saving} style={styles.saveBtn}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inline styles (vanilla CSS project — no Tailwind) ────

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0,
    background: "rgba(0,0,0,0.35)", zIndex: 9999,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  panel: {
    background: "#fff", borderRadius: 14, width: "min(580px, 95vw)",
    maxHeight: "85vh", overflow: "auto", padding: "1.2rem",
    boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: "0.8rem",
  },
  title: { margin: 0, fontSize: "1.15rem", fontWeight: 600 },
  closeBtn: {
    background: "none", border: "none", fontSize: "1.2rem",
    cursor: "pointer", padding: "0.3rem", color: "#6b7280",
  },
  error: {
    background: "#fef2f2", color: "#b91c1c", borderRadius: 8,
    padding: "0.5rem 0.7rem", marginBottom: "0.7rem", fontSize: "0.88rem",
  },
  success: {
    background: "#f0fdf4", color: "#15803d", borderRadius: 8,
    padding: "0.5rem 0.7rem", marginBottom: "0.7rem", fontSize: "0.88rem",
  },
  globalRow: {
    display: "flex", alignItems: "center", gap: "0.6rem",
    padding: "0.7rem", background: "#f8fafc", borderRadius: 10,
    marginBottom: "0.8rem", border: "1px solid #e2e8f0",
  },
  globalLabel: { fontWeight: 600, fontSize: "0.9rem", whiteSpace: "nowrap" as const },
  select: {
    flex: 1, padding: "0.45rem 0.5rem", borderRadius: 8,
    border: "1px solid #d1d5db", fontSize: "0.88rem",
  },
  groups: { display: "grid", gap: "0.7rem" },
  group: {
    border: "1px solid #e5e7eb", borderRadius: 10, padding: "0.7rem",
  },
  groupTitle: { margin: "0 0 0.5rem", fontSize: "0.85rem", color: "#6b7280", fontWeight: 600 },
  roleRow: {
    display: "flex", alignItems: "center", gap: "0.5rem",
    marginBottom: "0.35rem",
  },
  roleLabel: { width: 75, fontSize: "0.85rem", color: "#374151" },
  selectSmall: {
    flex: 1, padding: "0.3rem 0.4rem", borderRadius: 6,
    border: "1px solid #d1d5db", fontSize: "0.83rem",
  },
  footer: {
    display: "flex", justifyContent: "flex-end", gap: "0.5rem",
    marginTop: "1rem", paddingTop: "0.8rem", borderTop: "1px solid #e5e7eb",
  },
  cancelBtn: {
    padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid #d1d5db",
    background: "#fff", cursor: "pointer",
  },
  saveBtn: {
    padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid #2563eb",
    background: "#2563eb", color: "#fff", cursor: "pointer", fontWeight: 600,
  },
};
