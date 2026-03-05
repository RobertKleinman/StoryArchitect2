import React, { useState } from "react";
import { hookApi } from "../lib/hookApi";
import type { LLMProvider, ProviderModelEntry, ModelConfig } from "../../shared/modelConfig";

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "ChatGPT (OpenAI)",
  gemini: "Gemini (Google)",
  grok: "Grok (xAI)",
};

const PROVIDER_ORDER: LLMProvider[] = ["anthropic", "openai", "gemini", "grok"];

/**
 * Compact model selector shown at the top of each workshop module.
 * Lets the user pick a single model to use for ALL roles in the current module.
 * For testing purposes — swaps the entire pipeline to a different LLM provider/model.
 */
export function ModelSelector() {
  const [available, setAvailable] = useState<Record<LLMProvider, ProviderModelEntry[]> | null>(null);
  const [currentConfig, setCurrentConfig] = useState<ModelConfig | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  // Load available models and current config on mount
  React.useEffect(() => {
    Promise.all([hookApi.getAvailableModels(), hookApi.getModels()])
      .then(([avail, config]) => {
        setAvailable(avail.byProvider);
        setCurrentConfig(config);
        // Use the clarifier model as the "active" display model
        setSelectedModel(config.clarifier);
      })
      .catch(() => setError("Failed to load model list"));
  }, []);

  const applyModel = async (modelId: string) => {
    setSaving(true);
    setError(null);
    try {
      // Set ALL roles to the same model for easy A/B testing across providers
      const allRoles: Partial<ModelConfig> = {
        clarifier: modelId,
        builder: modelId,
        judge: modelId,
        summary: modelId,
        polish: modelId,
        char_clarifier: modelId,
        char_builder: modelId,
        char_judge: modelId,
        char_polish: modelId,
        char_summary: modelId,
        img_clarifier: modelId,
        img_builder: modelId,
        img_judge: modelId,
        img_summary: modelId,
      };
      const updated = await hookApi.setModels(allRoles);
      setCurrentConfig(updated);
      setSelectedModel(modelId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update model");
    } finally {
      setSaving(false);
    }
  };

  if (!available) {
    return null; // Still loading — don't block the UI
  }

  // Find the label for the currently selected model
  const allModels = Object.values(available).flat();
  const currentEntry = allModels.find((m) => m.id === selectedModel);
  const currentLabel = currentEntry
    ? `${PROVIDER_LABELS[currentEntry.provider]} — ${currentEntry.label}`
    : selectedModel;

  return (
    <div className="model-selector">
      <button
        type="button"
        className="model-selector-toggle"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="model-selector-icon">{collapsed ? "\u2699\uFE0F" : "\u25BC"}</span>
        <span className="model-selector-current">
          Model: <strong>{currentEntry?.label ?? selectedModel}</strong>
        </span>
      </button>

      {!collapsed && (
        <div className="model-selector-panel">
          <p className="model-selector-hint">
            Select a model to use for all pipeline steps in this module.
            Changing the model applies to all three modules (Hook, Character, Image).
          </p>

          {error && <p className="model-selector-error">{error}</p>}

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
                        disabled={saving}
                        onClick={() => void applyModel(m.id)}
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

          {saving && <p className="model-selector-saving">Applying...</p>}
        </div>
      )}
    </div>
  );
}
