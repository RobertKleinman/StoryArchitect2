import { useState } from "react";
import type { PromptOverrides } from "../../shared/types/hook";

interface PromptEditorProps {
  stage: string;
  systemPrompt: string;
  userPrompt: string;
  loading: boolean;
  onOverridesChange: (overrides: PromptOverrides | undefined) => void;
}

export function PromptEditor({
  stage,
  systemPrompt,
  userPrompt,
  loading,
  onOverridesChange,
}: PromptEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editSystem, setEditSystem] = useState(systemPrompt);
  const [editUser, setEditUser] = useState(userPrompt);

  const handleToggle = () => {
    if (!expanded) {
      // Reset edits when opening
      setEditSystem(systemPrompt);
      setEditUser(userPrompt);
      setEditing(false);
      onOverridesChange(undefined);
    }
    setExpanded(!expanded);
  };

  const handleEdit = () => {
    setEditing(true);
  };

  const handleApplyEdits = () => {
    const overrides: PromptOverrides = {};
    if (editSystem !== systemPrompt) overrides.system = editSystem;
    if (editUser !== userPrompt) overrides.user = editUser;
    onOverridesChange(Object.keys(overrides).length > 0 ? overrides : undefined);
    setEditing(false);
  };

  const handleResetEdits = () => {
    setEditSystem(systemPrompt);
    setEditUser(userPrompt);
    onOverridesChange(undefined);
    setEditing(false);
  };

  if (!expanded) {
    return (
      <button
        type="button"
        className="prompt-toggle"
        onClick={handleToggle}
        disabled={loading}
      >
        🔧 View {stage} prompt
      </button>
    );
  }

  return (
    <div className="prompt-editor">
      <div className="prompt-editor-header">
        <span className="prompt-editor-title">
          {stage.toUpperCase()} PROMPT
        </span>
        <div className="prompt-editor-actions">
          {!editing && (
            <button type="button" className="prompt-btn" onClick={handleEdit} disabled={loading}>
              ✏️ Edit
            </button>
          )}
          {editing && (
            <>
              <button type="button" className="prompt-btn primary-small" onClick={handleApplyEdits}>
                Apply
              </button>
              <button type="button" className="prompt-btn" onClick={handleResetEdits}>
                Reset
              </button>
            </>
          )}
          <button type="button" className="prompt-btn" onClick={handleToggle}>
            ✕ Close
          </button>
        </div>
      </div>

      <div className="prompt-section">
        <label className="prompt-label">System Prompt</label>
        {editing ? (
          <textarea
            className="prompt-textarea"
            value={editSystem}
            onChange={(e) => setEditSystem(e.target.value)}
            disabled={loading}
          />
        ) : (
          <pre className="prompt-display">{systemPrompt}</pre>
        )}
      </div>

      <div className="prompt-section">
        <label className="prompt-label">User Prompt</label>
        {editing ? (
          <textarea
            className="prompt-textarea"
            value={editUser}
            onChange={(e) => setEditUser(e.target.value)}
            disabled={loading}
          />
        ) : (
          <pre className="prompt-display">{userPrompt}</pre>
        )}
      </div>
    </div>
  );
}
