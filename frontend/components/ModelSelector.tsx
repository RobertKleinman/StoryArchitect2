import React, { useState } from "react";
import { hookApi } from "../lib/hookApi";
import type { LLMProvider, ProviderModelEntry, ModelConfig } from "../../shared/modelConfig";
import { JUDGE_ROLES, CREATIVE_ROLES } from "../../shared/modelConfig";

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "ChatGPT (OpenAI)",
  gemini: "Gemini (Google)",
  grok: "Grok (xAI)",
};

const PROVIDER_ORDER: LLMProvider[] = ["anthropic", "openai", "gemini", "grok"];

type Track = "creative" | "judge";

/**
 * Two-track model selector: lets the user pick separate models for
 * "Creative" stages (clarifier, builder, polish, summary) and
 * "Judge" stages across all modules.
 *
 * This prevents the "grading its own homework" problem where the same
 * model generates AND evaluates output.
 */
export function ModelSelector() {
  const [available, setAvailable] = useState<Record<LLMProvider, ProviderModelEntry[]> | null>(null);
  const [currentConfig, setCurrentConfig] = useState<ModelConfig | null>(null);
  const [creativeModel, setCreativeModel] = useState<string>("");
  const [judgeModel, setJudgeModel] = useState<string>("");
  const [saving, setSaving] = useState<Track | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  // Load available models and current config on mount
  React.useEffect(() => {
    Promise.all([hookApi.getAvailableModels(), hookApi.getModels()])
      .then(([avail, config]) => {
        setAvailable(avail.byProvider);
        setCurrentConfig(config);
        // Derive active selections from config
        setCreativeModel(config.clarifier);
        setJudgeModel(config.judge);
      })
      .catch(() => setError("Failed to load model list"));
  }, []);

  const applyModel = async (track: Track, modelId: string) => {
    setSaving(track);
    setError(null);
    try {
      const roles = track === "judge" ? JUDGE_ROLES : CREATIVE_ROLES;
      const partial: Partial<ModelConfig> = {};
      for (const role of roles) partial[role] = modelId;

      const updated = await hookApi.setModels(partial);
      setCurrentConfig(updated);
      if (track === "creative") setCreativeModel(modelId);
      else setJudgeModel(modelId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update model");
    } finally {
      setSaving(null);
    }
  };

  if (!available) return null;

  const allModels = Object.values(available).flat();
  const findLabel = (id: string) => allModels.find((m) => m.id === id)?.label ?? id;

  return (
    <div className="model-selector">
      <button
        type="button"
        className="model-selector-toggle"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="model-selector-icon">{collapsed ? "\u2699\uFE0F" : "\u25BC"}</span>
        <span className="model-selector-current">
          Creative: <strong>{findLabel(creativeModel)}</strong>
          {" \u00B7 "}
          Judge: <strong>{findLabel(judgeModel)}</strong>
        </span>
      </button>

      {!collapsed && (
        <div className="model-selector-panel">
          {error && <p className="model-selector-error">{error}</p>}

          {/* ── Creative track ───────────────────────────── */}
          <div className="model-track">
            <div className="model-track-header">
              <h3 className="model-track-title creative-track-title">Creative Model</h3>
              <p className="model-track-desc">
                Used for <strong>clarifier</strong>, <strong>builder</strong>, <strong>polish</strong>, and <strong>summary</strong> stages across all modules.
                This model generates the actual creative content.
              </p>
            </div>
            <ModelChipGrid
              available={available}
              selectedModel={creativeModel}
              disabled={saving !== null}
              onSelect={(id) => void applyModel("creative", id)}
            />
            {saving === "creative" && <p className="model-selector-saving">Applying to creative roles...</p>}
          </div>

          <div className="model-track-divider" />

          {/* ── Judge track ──────────────────────────────── */}
          <div className="model-track">
            <div className="model-track-header">
              <h3 className="model-track-title judge-track-title">Judge Model</h3>
              <p className="model-track-desc">
                Used for all <strong>judge</strong> stages. Evaluates and scores output from the creative model.
                Use a <em>different</em> model from your creative model for best results.
              </p>
            </div>
            <ModelChipGrid
              available={available}
              selectedModel={judgeModel}
              disabled={saving !== null}
              onSelect={(id) => void applyModel("judge", id)}
            />
            {saving === "judge" && <p className="model-selector-saving">Applying to judge roles...</p>}
          </div>

          {/* Same-model warning */}
          {creativeModel && judgeModel && creativeModel === judgeModel && (
            <p className="model-selector-warning">
              Creative and Judge are using the same model. For better quality assessment,
              consider using different models so the judge isn't grading its own homework.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Reusable chip grid — renders provider groups with selectable model chips */
function ModelChipGrid({
  available,
  selectedModel,
  disabled,
  onSelect,
}: {
  available: Record<LLMProvider, ProviderModelEntry[]>;
  selectedModel: string;
  disabled: boolean;
  onSelect: (modelId: string) => void;
}) {
  return (
    <div className="model-selector-providers">
      {PROVIDER_ORDER.map((provider) => {
        const models = available[provider];
        if (!models || models.length === 0) return null;
        return (
          <div key={provider} className="model-provider-group">
            <h4 className="model-provider-label">{PROVIDER_LABELS[provider]}</h4>
            <div className="model-chips">
              {models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`model-chip ${m.id === selectedModel ? "active" : ""} tier-${m.tier}`}
                  disabled={disabled}
                  onClick={() => onSelect(m.id)}
                >
                  {m.label}
                  <span className="model-tier-badge">{m.tier}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
