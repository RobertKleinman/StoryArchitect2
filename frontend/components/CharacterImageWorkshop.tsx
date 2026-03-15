import React, { useMemo, useState } from "react";
import { characterImageApi } from "../lib/characterImageApi";
import { emitModuleStatus } from "./App";
import { PsychologyOverlay } from "./PsychologyOverlay";
import { EngineInsights } from "./EngineInsights";
import { ModelSelector } from "./ModelSelector";
import type {
  CharacterImageAssumptionResponse,
  CharacterImageBuilderOutput,
  CharacterImageClarifierOption,
  CharacterImageAssumption,
  CharacterImageJudgeScores,
  GeneratedCharacterImage,
  VisualAnchor,
} from "../../shared/types/characterImage";

type Phase =
  | "connect"
  | "seeding"
  | "clarifying"
  | "art_style"
  | "generating"
  | "revealed"
  | "model_select"
  | "generating_images"
  | "image_review"
  | "locked";

interface WorkshopState {
  phase: Phase;
  hypothesisLine: string;
  question: string;
  options: CharacterImageClarifierOption[];
  allowFreeText: boolean;
  freeTextValue: string;
  characterFocus: string | null;
  turnNumber: number;
  readyForImages: boolean;
  readinessPct: number;
  readinessNote: string;
  conflictFlag: string;
  revealedSpecs: CharacterImageBuilderOutput | null;
  judgeInfo: {
    passed: boolean;
    hard_fail_reasons: string[];
    scores: CharacterImageJudgeScores;
    distinctiveness_notes: string;
    one_fix_instruction: string;
  } | null;
  generatedImages: Record<string, GeneratedCharacterImage>;
  loading: boolean;
  loadingMessage: string;
  error: string | null;
  assumptions: CharacterImageAssumption[];
  assumptionResponses: Record<string, { action: "keep" | "alternative" | "freeform" | "not_ready"; value: string }>;
  selectedOptionId: string | null;
  selectedOptionLabel: string | null;
  visualSeedValue: string;
  // Art style selection
  selectedArtStyle: string | null;
  artStyleCustomNote: string;
  // Visual edits (per-character anchor tweaks)
  visualEdits: Record<string, Partial<Record<keyof VisualAnchor, string>>>;
  // Model selection
  availableModels: { checkpoints: string[]; loras: string[] } | null;
  selectedCheckpoint: string;
  selectedLora: string;
  selectedQuality: string;
}

const initialState: WorkshopState = {
  phase: "connect",
  hypothesisLine: "",
  question: "",
  options: [],
  allowFreeText: true,
  freeTextValue: "",
  characterFocus: null,
  turnNumber: 0,
  readyForImages: false,
  readinessPct: 0,
  readinessNote: "",
  conflictFlag: "",
  revealedSpecs: null,
  judgeInfo: null,
  generatedImages: {},
  loading: false,
  loadingMessage: "",
  error: null,
  assumptions: [],
  assumptionResponses: {},
  selectedOptionId: null,
  selectedOptionLabel: null,
  visualSeedValue: "",
  selectedArtStyle: null,
  artStyleCustomNote: "",
  visualEdits: {},
  availableModels: null,
  selectedCheckpoint: "",
  selectedLora: "none",
  selectedQuality: "balanced",
};

const ART_STYLES = [
  {
    id: "soft-painterly",
    name: "Soft & Painterly",
    description: "Warm brushstrokes, atmospheric lighting, subtle color gradients. Think Ghibli-inspired watercolor meets modern illustration.",
    vibe: "Dreamy, emotional, gentle",
  },
  {
    id: "cel-shaded-vibrant",
    name: "Cel-Shaded & Vibrant",
    description: "Bold outlines, saturated colors, dynamic poses. Clean anime style with high contrast and expressive features.",
    vibe: "Energetic, punchy, eye-catching",
  },
  {
    id: "gritty-detailed",
    name: "Gritty & Detailed",
    description: "Fine linework, muted tones, realistic proportions. Textured rendering with dramatic lighting and shadow depth.",
    vibe: "Intense, mature, cinematic",
  },
  {
    id: "stylized-minimal",
    name: "Stylized & Minimal",
    description: "Simplified shapes, limited palette, strong silhouettes. Modern character design with flat colors and geometric flair.",
    vibe: "Clean, modern, distinctive",
  },
];

const IMG_SESSION_KEY = "charImageWorkshop_projectId";
const IMG_CHAR_ID_KEY = "charImageWorkshop_characterProjectId";
const CHAR_SESSION_KEY = "characterWorkshop_projectId";

function makeProjectId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `img-${crypto.randomUUID()}`;
  }
  return `img-${Date.now()}`;
}

function loadSaved(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function saveTo(key: string, id: string) {
  try { localStorage.setItem(key, id); } catch {}
}
function clearSaved(key: string) {
  try { localStorage.removeItem(key); } catch {}
}

interface CharacterSessionInfo {
  projectId: string;
  status: string;
  turnCount: number;
  castCount: number;
  characterRoles: string[];
  hasExport: boolean;
  ensembleDynamic: string;
}

export function CharacterImageWorkshop() {
  const [projectId, setProjectId] = useState(() => {
    return loadSaved(IMG_SESSION_KEY) ?? makeProjectId();
  });

  const [characterProjectId, setCharacterProjectId] = useState(() => {
    return loadSaved(IMG_CHAR_ID_KEY) ?? loadSaved(CHAR_SESSION_KEY) ?? "";
  });
  const [charIdInput, setCharIdInput] = useState(() => {
    return loadSaved(IMG_CHAR_ID_KEY) ?? loadSaved(CHAR_SESSION_KEY) ?? "";
  });
  const [charValidated, setCharValidated] = useState(false);

  // Available character sessions for the connect phase
  const [availableSessions, setAvailableSessions] = useState<CharacterSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);

  const [state, setState] = useState<WorkshopState>(initialState);
  const [showPsych, setShowPsych] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const fetchPsych = useMemo(() => () => characterImageApi.debugPsychology(projectId), [projectId]);
  const fetchInsights = useMemo(() => () => characterImageApi.debugInsights(projectId), [projectId]);

  // ─── Load available character sessions on mount ───
  React.useEffect(() => {
    setSessionsLoading(true);
    setSessionsError(null);
    characterImageApi.listCharacterSessions()
      .then(({ sessions }) => {
        setAvailableSessions(sessions);
        // Auto-select if there's exactly one locked session
        const locked = sessions.filter(s => s.hasExport);
        if (locked.length === 1 && !charIdInput) {
          setCharIdInput(locked[0].projectId);
        }
      })
      .catch((err) => {
        setSessionsError(err.message ?? "Failed to load character sessions");
      })
      .finally(() => setSessionsLoading(false));
  }, []);

  // ─── Recovery check ───
  const [recoveryChecked, setRecoveryChecked] = useState(false);

  React.useEffect(() => {
    const savedId = loadSaved(IMG_SESSION_KEY);
    if (savedId) {
      characterImageApi.getSession(savedId).then((session) => {
        if (session && session.status !== "locked") {
          setProjectId(session.projectId);
          setCharacterProjectId(session.characterProjectId);
          setCharIdInput(session.characterProjectId);
          setCharValidated(true);
          saveTo(IMG_CHAR_ID_KEY, session.characterProjectId);

          const lastTurn = session.turns?.length > 0 ? session.turns[session.turns.length - 1] : null;

          if (session.status === "image_review" && Object.keys(session.generatedImages).length > 0) {
            setState(prev => ({
              ...prev,
              phase: "image_review",
              generatedImages: session.generatedImages,
              revealedSpecs: session.revealedSpecs ?? null,
              turnNumber: session.turns?.length ?? 0,
            }));
          } else if ((session.status === "revealed") && session.revealedSpecs) {
            setState(prev => ({
              ...prev,
              phase: "revealed",
              revealedSpecs: session.revealedSpecs ?? null,
              judgeInfo: session.revealedJudge ? {
                passed: session.revealedJudge.pass,
                hard_fail_reasons: session.revealedJudge.hard_fail_reasons,
                scores: session.revealedJudge.scores,
                distinctiveness_notes: session.revealedJudge.distinctiveness_notes,
                one_fix_instruction: session.revealedJudge.one_fix_instruction,
              } : null,
              turnNumber: session.turns?.length ?? 0,
            }));
          } else if (session.status === "clarifying" && lastTurn) {
            setState(prev => ({
              ...prev,
              phase: "clarifying",
              hypothesisLine: lastTurn.clarifierResponse.hypothesis_line,
              question: lastTurn.clarifierResponse.question,
              options: lastTurn.clarifierResponse.options,
              allowFreeText: lastTurn.clarifierResponse.allow_free_text,
              characterFocus: lastTurn.clarifierResponse.character_focus,
              turnNumber: session.turns.length,
              readyForImages: lastTurn.clarifierResponse.ready_for_images,
              readinessPct: lastTurn.clarifierResponse.readiness_pct ?? 0,
              readinessNote: lastTurn.clarifierResponse.readiness_note ?? "",
              conflictFlag: lastTurn.clarifierResponse.conflict_flag ?? "",
              assumptions: lastTurn.clarifierResponse.assumptions ?? [],
              assumptionResponses: {},
            }));
          }
        }
        setRecoveryChecked(true);
      }).catch(() => setRecoveryChecked(true));
    } else {
      setRecoveryChecked(true);
    }
  }, []);

  // ─── Actions ───

  const validateCharacterExport = async () => {
    setState(s => ({ ...s, loading: true, loadingMessage: "Checking character export...", error: null }));
    try {
      await characterImageApi.checkCharacterExport(charIdInput);
      setCharacterProjectId(charIdInput);
      saveTo(IMG_CHAR_ID_KEY, charIdInput);
      setCharValidated(true);
      setState(s => ({ ...s, phase: "seeding", loading: false }));
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: `Character export not found: ${err.message}. Complete and lock the Character module first.` }));
    }
  };

  const startClarification = async () => {
    setState(s => ({ ...s, loading: true, loadingMessage: "Starting visual discovery...", error: null }));
    try {
      const newId = makeProjectId();
      setProjectId(newId);
      saveTo(IMG_SESSION_KEY, newId);

      const result = await characterImageApi.clarify({
        projectId: newId,
        characterProjectId,
        visualSeed: state.visualSeedValue || undefined,
      });

      setState(s => ({
        ...s,
        phase: "clarifying",
        hypothesisLine: result.clarifier.hypothesis_line,
        question: result.clarifier.question,
        options: result.clarifier.options,
        allowFreeText: result.clarifier.allow_free_text,
        characterFocus: result.clarifier.character_focus,
        turnNumber: result.turnNumber,
        readyForImages: result.clarifier.ready_for_images,
        readinessPct: result.clarifier.readiness_pct ?? 0,
        readinessNote: result.clarifier.readiness_note ?? "",
        conflictFlag: result.clarifier.conflict_flag ?? "",
        assumptions: result.clarifier.assumptions ?? [],
        assumptionResponses: {},
        loading: false,
        selectedOptionId: null,
        selectedOptionLabel: null,
        freeTextValue: "",
      }));
      emitModuleStatus("character_image", "active");
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  const submitTurn = async () => {
    if (!state.selectedOptionId && !state.freeTextValue.trim()) return;

    const userSelection = state.freeTextValue.trim()
      ? { type: "free_text" as const, label: state.freeTextValue.trim() }
      : { type: "option" as const, optionId: state.selectedOptionId!, label: state.selectedOptionLabel! };

    const assumptionResponses: CharacterImageAssumptionResponse[] = [];
    for (const [id, resp] of Object.entries(state.assumptionResponses)) {
      const assumption = state.assumptions.find(a => a.id === id);
      if (!assumption) continue;
      assumptionResponses.push({
        assumptionId: id,
        characterRole: assumption.characterRole,
        category: assumption.category,
        action: resp.action,
        originalValue: assumption.assumption,
        newValue: resp.value,
      });
    }

    setState(s => ({ ...s, loading: true, loadingMessage: "Shaping the visuals...", error: null }));
    try {
      const result = await characterImageApi.clarify({
        projectId,
        characterProjectId,
        userSelection,
        assumptionResponses: assumptionResponses.length > 0 ? assumptionResponses : undefined,
      });

      setState(s => ({
        ...s,
        phase: "clarifying",
        hypothesisLine: result.clarifier.hypothesis_line,
        question: result.clarifier.question,
        options: result.clarifier.options,
        allowFreeText: result.clarifier.allow_free_text,
        characterFocus: result.clarifier.character_focus,
        turnNumber: result.turnNumber,
        readyForImages: result.clarifier.ready_for_images,
        readinessPct: result.clarifier.readiness_pct ?? 0,
        readinessNote: result.clarifier.readiness_note ?? "",
        conflictFlag: result.clarifier.conflict_flag ?? "",
        assumptions: result.clarifier.assumptions ?? [],
        assumptionResponses: {},
        loading: false,
        selectedOptionId: null,
        selectedOptionLabel: null,
        freeTextValue: "",
      }));
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  const generateSpecs = async () => {
    setState(s => ({ ...s, phase: "generating", loading: true, loadingMessage: "Building visual descriptions...", error: null }));
    try {
      const result = await characterImageApi.generate(projectId);
      setState(s => ({
        ...s,
        phase: "revealed",
        revealedSpecs: result.specs,
        judgeInfo: result.judge,
        loading: false,
      }));
    } catch (err: any) {
      setState(s => ({ ...s, phase: "clarifying", loading: false, error: err.message }));
    }
  };

  const confirmArtStyleAndGenerate = async () => {
    if (!state.selectedArtStyle) return;
    setState(s => ({ ...s, phase: "generating", loading: true, loadingMessage: "Saving style & building visual descriptions...", error: null }));
    try {
      await characterImageApi.setArtStyle(projectId, state.selectedArtStyle, state.artStyleCustomNote || undefined);
      const result = await characterImageApi.generate(projectId);
      setState(s => ({
        ...s,
        phase: "revealed",
        revealedSpecs: result.specs,
        judgeInfo: result.judge,
        loading: false,
      }));
    } catch (err: any) {
      setState(s => ({ ...s, phase: "art_style", loading: false, error: err.message }));
    }
  };

  const rerollSpecs = async () => {
    setState(s => ({ ...s, loading: true, loadingMessage: "Regenerating visual descriptions...", error: null }));
    try {
      const result = await characterImageApi.reroll(projectId);
      setState(s => ({
        ...s,
        revealedSpecs: result.specs,
        judgeInfo: result.judge,
        loading: false,
      }));
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  const loadModels = async () => {
    setState(s => ({ ...s, loading: true, loadingMessage: "Saving edits & loading models...", error: null }));
    try {
      // Apply any visual anchor edits the user made
      const hasEdits = Object.keys(state.visualEdits).length > 0;
      if (hasEdits) {
        await characterImageApi.applyVisualEdits(projectId, state.visualEdits as Record<string, Record<string, string>>);
      }
      const models = await characterImageApi.getAnimeGenModels();
      setState(s => ({
        ...s,
        phase: "model_select",
        availableModels: models,
        selectedCheckpoint: models.checkpoints[0] ?? "",
        loading: false,
      }));
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: `Could not load models. Is the anime generator running? ${err.message}` }));
    }
  };

  const generateImages = async () => {
    setState(s => ({ ...s, phase: "generating_images", loading: true, loadingMessage: "Generating character portraits... (this may take a few minutes)", error: null }));
    try {
      const result = await characterImageApi.generateImages({
        projectId,
        checkpoint: state.selectedCheckpoint,
        lora: state.selectedLora === "none" ? undefined : state.selectedLora,
        quality: state.selectedQuality,
      });
      setState(s => ({
        ...s,
        phase: "image_review",
        generatedImages: result.images,
        loading: false,
      }));
    } catch (err: any) {
      setState(s => ({ ...s, phase: "model_select", loading: false, error: err.message }));
    }
  };

  const approveImage = async (role: string) => {
    try {
      const updated = await characterImageApi.approveImage(projectId, role);
      setState(s => ({
        ...s,
        generatedImages: { ...s.generatedImages, [role]: updated },
      }));
    } catch (err: any) {
      setState(s => ({ ...s, error: err.message }));
    }
  };

  const redoImage = async (role: string) => {
    setState(s => ({ ...s, loading: true, loadingMessage: `Regenerating ${role}...`, error: null }));
    try {
      const overrides = {
        checkpoint: state.selectedCheckpoint || undefined,
        lora: state.selectedLora !== "none" ? state.selectedLora : undefined,
        quality: state.selectedQuality || undefined,
      };
      const updated = await characterImageApi.redoImage(projectId, role, undefined, overrides);
      setState(s => ({
        ...s,
        generatedImages: { ...s.generatedImages, [role]: updated },
        loading: false,
      }));
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  const lockImages = async () => {
    setState(s => ({ ...s, loading: true, loadingMessage: "Locking character images...", error: null }));
    try {
      await characterImageApi.lock(projectId);
      setState(s => ({ ...s, phase: "locked", loading: false }));
      emitModuleStatus("character_image", "locked");
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  const resetAll = async () => {
    try { await characterImageApi.reset(projectId); } catch {}
    clearSaved(IMG_SESSION_KEY);
    clearSaved(IMG_CHAR_ID_KEY);
    const newId = makeProjectId();
    setProjectId(newId);
    setCharacterProjectId("");
    setCharIdInput(loadSaved(CHAR_SESSION_KEY) ?? "");
    setCharValidated(false);
    setState(initialState);
    emitModuleStatus("character_image", "idle");
  };

  // ─── Render helpers ───

  const selectOption = (opt: CharacterImageClarifierOption) => {
    setState(s => ({
      ...s,
      selectedOptionId: opt.id,
      selectedOptionLabel: opt.label,
      freeTextValue: "",
    }));
  };

  const setAssumptionAction = (id: string, action: "keep" | "alternative" | "freeform" | "not_ready", value: string) => {
    setState(s => ({
      ...s,
      assumptionResponses: { ...s.assumptionResponses, [id]: { action, value } },
    }));
  };

  const allImagesApproved = Object.values(state.generatedImages).every(img => img.approved);
  const [rerollSelected, setRerollSelected] = useState<string[]>([]);

  const toggleRerollSelect = (role: string) => {
    setRerollSelected(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  };

  const batchRedoImages = async () => {
    if (rerollSelected.length === 0) return;
    const roles = [...rerollSelected];
    const overrides = {
      checkpoint: state.selectedCheckpoint || undefined,
      lora: state.selectedLora !== "none" ? state.selectedLora : undefined,
      quality: state.selectedQuality || undefined,
    };
    setState(s => ({ ...s, loading: true, loadingMessage: `Regenerating ${roles.length} character(s)...`, error: null }));
    try {
      for (const role of roles) {
        const updated = await characterImageApi.redoImage(projectId, role, undefined, overrides);
        setState(s => ({
          ...s,
          generatedImages: { ...s.generatedImages, [role]: updated },
        }));
      }
      setRerollSelected([]);
      setState(s => ({ ...s, loading: false }));
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  // ─── Render ───

  if (!recoveryChecked) {
    return (
      <div className="workshop">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
    );
  }

  return (
    <div className="workshop character-image-workshop">
      <ModelSelector />

      <div className="workshop-header">
        <h2>Character Images</h2>
        {state.phase !== "connect" && state.phase !== "locked" && (
          <button type="button" className="btn-ghost btn-sm" onClick={resetAll}>Start Over</button>
        )}
      </div>

      {state.error && (
        <div className="error-banner">
          <p>{state.error}</p>
          <button type="button" onClick={() => setState(s => ({ ...s, error: null }))}>Dismiss</button>
        </div>
      )}

      {state.loading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <p>{state.loadingMessage}</p>
        </div>
      )}

      {/* ─── Phase: Connect to Character Module ─── */}
      {state.phase === "connect" && (
        <div className="connect-phase">
          <p>Select a locked character session to start designing visual identities.</p>

          {sessionsLoading && <p className="loading-text">Loading available sessions...</p>}

          {sessionsError && (
            <div className="error-banner">
              <p>Could not load sessions: {sessionsError}</p>
              <button type="button" onClick={() => setShowManualInput(true)}>Enter ID manually</button>
            </div>
          )}

          {!sessionsLoading && !sessionsError && availableSessions.length > 0 && (
            <div className="session-list">
              {availableSessions.map(s => {
                const isLocked = s.hasExport;
                const isSelected = charIdInput === s.projectId;
                return (
                  <div
                    key={s.projectId}
                    className={`session-card ${isSelected ? "session-card-selected" : ""} ${!isLocked ? "session-card-disabled" : ""}`}
                    onClick={() => { if (isLocked) setCharIdInput(s.projectId); }}
                  >
                    <div className="session-card-header">
                      <span className={`session-status ${isLocked ? "status-locked" : "status-" + s.status}`}>
                        {isLocked ? "✓ Locked" : s.status}
                      </span>
                      <span className="session-cast-count">{s.castCount} characters</span>
                    </div>
                    <div className="session-card-roles">
                      {s.characterRoles.map(r => (
                        <span key={r} className="role-chip">{r}</span>
                      ))}
                    </div>
                    {s.ensembleDynamic && (
                      <p className="session-card-dynamic">{s.ensembleDynamic.slice(0, 120)}{s.ensembleDynamic.length > 120 ? "..." : ""}</p>
                    )}
                    <div className="session-card-meta">
                      <span>{s.turnCount} turns</span>
                      {!isLocked && <span className="warn-text">Not locked yet — complete the Character module first</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!sessionsLoading && !sessionsError && availableSessions.length === 0 && (
            <p className="empty-text">No character sessions found. Complete the Character module first.</p>
          )}

          {/* Manual ID input fallback */}
          {(showManualInput || (!sessionsLoading && !sessionsError && availableSessions.length === 0)) && (
            <div className="manual-input-section">
              <p style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "0.4rem" }}>Or enter a character project ID manually:</p>
              <div className="seed-row">
                <input
                  value={charIdInput}
                  onChange={(e) => setCharIdInput(e.target.value)}
                  placeholder="Paste character project ID here..."
                  disabled={state.loading}
                />
              </div>
            </div>
          )}

          {!showManualInput && availableSessions.length > 0 && (
            <button type="button" className="link-btn" style={{ fontSize: "0.82rem", marginTop: "0.4rem" }}
              onClick={() => setShowManualInput(true)}>
              Enter ID manually instead
            </button>
          )}

          <div className="action-row" style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="btn-primary"
              onClick={validateCharacterExport}
              disabled={!charIdInput.trim() || state.loading}
            >
              Connect to Selected Session
            </button>
          </div>
        </div>
      )}

      {/* ─── Phase: Visual Seed ─── */}
      {state.phase === "seeding" && (
        <div className="seed-phase">
          <h3>What visual style do you have in mind?</h3>
          <p>Describe the look and feel you're imagining — or leave blank and we'll figure it out together.</p>
          <textarea
            className="seed-textarea"
            value={state.visualSeedValue}
            onChange={e => setState(s => ({ ...s, visualSeedValue: e.target.value }))}
            placeholder="e.g., 'Dark fantasy vibes, muted colors with splashes of crimson. The protagonist should feel dangerous but beautiful...'"
            rows={4}
          />
          <button type="button" className="btn-primary" onClick={startClarification} disabled={state.loading}>
            {state.visualSeedValue.trim() ? "Start with this vision" : "Start fresh — surprise me"}
          </button>
        </div>
      )}

      {/* ─── Phase: Clarifying ─── */}
      {state.phase === "clarifying" && !state.loading && (
        <div className="clarifier-phase">
          {state.hypothesisLine && (
            <div className="hypothesis-line">
              <p>{state.hypothesisLine}</p>
            </div>
          )}

          {state.conflictFlag && (
            <div className="conflict-flag">
              <p>⚠ {state.conflictFlag}</p>
              <div className="conflict-actions">
                <button
                  type="button"
                  className="chip-sm"
                  onClick={() => setState(s => ({ ...s, freeTextValue: `Regarding the conflict: I want to keep both as-is`, selectedOptionId: null, selectedOptionLabel: null }))}
                >
                  Keep both
                </button>
                <button
                  type="button"
                  className="chip-sm"
                  onClick={() => setState(s => ({ ...s, freeTextValue: `Regarding the conflict: `, selectedOptionId: null, selectedOptionLabel: null }))}
                >
                  I'll resolve it...
                </button>
              </div>
            </div>
          )}

          <div className="readiness-bar">
            <div className="readiness-fill" style={{ width: `${state.readinessPct}%` }} />
            <span>{state.readinessPct}% — {state.readinessNote || "Shaping visual identity..."}</span>
          </div>

          {state.characterFocus && (
            <div className="character-focus-tag">
              Focusing on: <strong>{state.characterFocus}</strong>
            </div>
          )}

          <div className="question-section">
            <h3>{state.question}</h3>

            <div className="options-row">
              {state.options.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  className={`chip ${state.selectedOptionId === opt.id ? "chip-selected" : ""}`}
                  onClick={() => selectOption(opt)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {state.allowFreeText && (
              <textarea
                className="free-text-input"
                value={state.freeTextValue}
                onChange={e => {
                  setState(s => ({ ...s, freeTextValue: e.target.value, selectedOptionId: null, selectedOptionLabel: null }));
                }}
                placeholder="Or describe what you see..."
                rows={2}
              />
            )}
          </div>

          {/* Assumptions */}
          {state.assumptions.length > 0 && (
            <div className="assumptions-section">
              <h4>Visual assumptions — shape these:</h4>
              {state.assumptions.map(a => {
                const resp = state.assumptionResponses[a.id];
                return (
                  <div key={a.id} className="assumption-card">
                    <div className="assumption-header">
                      <span className="assumption-role">{a.characterRole}</span>
                      <span className="assumption-text">{a.assumption}</span>
                    </div>
                    <div className="assumption-actions">
                      <button
                        type="button"
                        className={`chip-sm ${resp?.action === "keep" ? "chip-selected" : ""}`}
                        onClick={() => setAssumptionAction(a.id, "keep", a.assumption)}
                      >
                        ✓ Keep
                      </button>
                      {a.alternatives.map((alt, i) => {
                        const isSelected = resp?.action === "alternative" && resp.value.split(" + ").includes(alt);
                        return (
                          <button
                            key={i}
                            type="button"
                            className={`chip-sm ${isSelected ? "chip-selected" : ""}`}
                            onClick={() =>
                              setState((prev) => {
                                const prevResp = prev.assumptionResponses[a.id];
                                const prevAlts = (prevResp?.action === "alternative" && prevResp.value)
                                  ? prevResp.value.split(" + ") : [];
                                let newAlts: string[];
                                if (prevAlts.includes(alt)) { newAlts = prevAlts.filter((v) => v !== alt); }
                                else { newAlts = [...prevAlts, alt]; }
                                return {
                                  ...prev,
                                  assumptionResponses: {
                                    ...prev.assumptionResponses,
                                    [a.id]: newAlts.length > 0
                                      ? { action: "alternative" as const, value: newAlts.join(" + ") }
                                      : { action: "keep" as const, value: a.assumption },
                                  },
                                };
                              })
                            }
                          >
                            {alt}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className={`chip-sm ${resp?.action === "not_ready" ? "chip-selected" : ""}`}
                        onClick={() => setAssumptionAction(a.id, "not_ready", "")}
                      >
                        Not sure yet
                      </button>
                      {resp?.action !== "freeform" && (
                        <button
                          type="button"
                          className="assumption-btn assumption-freeform-trigger"
                          onClick={() => setAssumptionAction(a.id, "freeform", "")}
                        >
                          My own idea...
                        </button>
                      )}
                    </div>
                    {resp?.action === "freeform" && (
                      <div className="assumption-freeform">
                        <input
                          type="text"
                          placeholder="Type your own idea..."
                          value={resp.value}
                          onChange={(e) =>
                            setState((prev) => ({
                              ...prev,
                              assumptionResponses: {
                                ...prev.assumptionResponses,
                                [a.id]: { action: "freeform", value: e.target.value },
                              },
                            }))
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="action-row">
            <button type="button" className="btn-primary" onClick={submitTurn}
              disabled={!state.selectedOptionId && !state.freeTextValue.trim()}>
              Continue
            </button>
            {state.readyForImages && (
              <button type="button" className="btn-accent" onClick={() => setState(s => ({ ...s, phase: "art_style" }))}>
                Choose Art Style →
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── Phase: Art Style ─── */}
      {state.phase === "art_style" && (
        <div className="art-style-phase">
          <h3>Choose an Art Style</h3>
          <p className="art-style-intro">Pick a visual direction for your characters. This guides how they'll look — you can always customize further.</p>

          <div className="art-style-grid">
            {ART_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`art-style-card${state.selectedArtStyle === s.id ? " art-style-selected" : ""}`}
                onClick={() => setState(prev => ({ ...prev, selectedArtStyle: s.id }))}
              >
                <div className="art-style-name">{s.name}</div>
                <div className="art-style-desc">{s.description}</div>
                <div className="art-style-vibe">{s.vibe}</div>
              </button>
            ))}
          </div>

          <div className="art-style-custom">
            <input
              type="text"
              placeholder="Any specific style notes? (optional)"
              value={state.artStyleCustomNote}
              onChange={(e) => setState(prev => ({ ...prev, artStyleCustomNote: e.target.value }))}
            />
          </div>

          <div className="action-row">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setState(s => ({ ...s, phase: "clarifying" }))}
            >
              ← Back
            </button>
            <button
              type="button"
              className="btn-accent"
              disabled={!state.selectedArtStyle || state.loading}
              onClick={confirmArtStyleAndGenerate}
            >
              Generate Visual Descriptions →
            </button>
          </div>
        </div>
      )}

      {/* ─── Phase: Generating ─── */}
      {state.phase === "generating" && !state.loading && (
        <div className="generating-phase">
          <p>Building visual descriptions for your cast...</p>
        </div>
      )}

      {/* ─── Phase: Revealed (visual specs) ─── */}
      {state.phase === "revealed" && state.revealedSpecs && (
        <div className="revealed-phase">
          <h3>Visual Descriptions</h3>

          {state.judgeInfo && (
            <div className={`judge-banner ${state.judgeInfo.passed ? "judge-pass" : "judge-fail"}`}>
              <strong>{state.judgeInfo.passed ? "✓ PASSED" : "✗ NEEDS WORK"}</strong>
              {!state.judgeInfo.passed && state.judgeInfo.hard_fail_reasons.length > 0 && (
                <ul>
                  {state.judgeInfo.hard_fail_reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
              <div className="judge-scores">
                {Object.entries(state.judgeInfo.scores).map(([key, val]) => (
                  <span key={key} className="score-pill">
                    {key.replace(/_/g, " ")}: <strong>{val}/10</strong>
                  </span>
                ))}
              </div>
              {state.judgeInfo.distinctiveness_notes && (
                <p className="judge-note">{state.judgeInfo.distinctiveness_notes}</p>
              )}
              {state.judgeInfo.one_fix_instruction && (
                <p className="judge-fix"><strong>Suggested fix:</strong> {state.judgeInfo.one_fix_instruction}</p>
              )}
            </div>
          )}

          {state.revealedSpecs.style_recommendation && (
            <div className="style-recommendation">
              <strong>Recommended style:</strong> {state.revealedSpecs.style_recommendation}
              {state.revealedSpecs.style_reasoning && (
                <span className="style-reasoning"> — {state.revealedSpecs.style_reasoning}</span>
              )}
            </div>
          )}

          {Object.entries(state.revealedSpecs.characters).map(([role, spec]) => {
            const edits = state.visualEdits[role] ?? {};
            const anchor = (field: keyof VisualAnchor) =>
              (edits[field] !== undefined ? edits[field] : spec.visual_anchors[field]) as string;
            const setAnchor = (field: keyof VisualAnchor, value: string) =>
              setState(s => ({
                ...s,
                visualEdits: {
                  ...s.visualEdits,
                  [role]: { ...(s.visualEdits[role] ?? {}), [field]: value },
                },
              }));
            return (
              <div key={role} className="visual-spec-card">
                <h4>{role}</h4>
                <p className="spec-description">{spec.full_body_description}</p>
                <div className="spec-anchors-editable">
                  {([
                    ["hair_description", "Hair"],
                    ["eyes_description", "Eyes"],
                    ["signature_garment", "Signature outfit"],
                    ["body_type", "Build"],
                    ["pose_baseline", "Default pose"],
                    ["expression_baseline", "Expression"],
                    ["visual_vibe", "Vibe"],
                    ["distinguishing_marks", "Marks / accessories"],
                  ] as [keyof VisualAnchor, string][]).map(([field, label]) => (
                    <div key={field} className="anchor-edit-row">
                      <label className="anchor-label">{label}</label>
                      <input
                        className={`anchor-input${edits[field] !== undefined ? " anchor-edited" : ""}`}
                        value={anchor(field)}
                        onChange={(e) => setAnchor(field, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
                {spec.visual_anchors.color_palette?.length > 0 && (
                  <div className="color-palette">
                    {spec.visual_anchors.color_palette.map((color, i) => (
                      <span key={i} className="color-swatch" style={{
                        background: color.startsWith("#") ? color : undefined,
                      }}>
                        {color}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {state.revealedSpecs.ensemble_cohesion_note && (
            <p className="ensemble-note"><strong>Ensemble:</strong> {state.revealedSpecs.ensemble_cohesion_note}</p>
          )}

          <div className="action-row">
            <button type="button" className="btn-primary" onClick={loadModels}>
              Proceed to Image Generation →
            </button>
            <button type="button" className="btn-ghost" onClick={rerollSpecs}>
              Regenerate Descriptions
            </button>
          </div>
        </div>
      )}

      {/* ─── Phase: Model Selection ─── */}
      {state.phase === "model_select" && state.availableModels && (
        <div className="model-select-phase">
          <h3>Choose Generation Settings</h3>
          <p>Select the art style and quality for your character portraits.</p>

          <div className="model-form">
            <div className="form-group">
              <label>Checkpoint (art style)</label>
              <select
                value={state.selectedCheckpoint}
                onChange={e => setState(s => ({ ...s, selectedCheckpoint: e.target.value }))}
              >
                {state.availableModels.checkpoints.map(cp => (
                  <option key={cp} value={cp}>{cp}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>LoRA (optional style modifier)</label>
              <select
                value={state.selectedLora}
                onChange={e => setState(s => ({ ...s, selectedLora: e.target.value }))}
              >
                <option value="none">None</option>
                {state.availableModels.loras.map(lr => (
                  <option key={lr} value={lr}>{lr}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Quality</label>
              <select
                value={state.selectedQuality}
                onChange={e => setState(s => ({ ...s, selectedQuality: e.target.value }))}
              >
                <option value="lightning">Lightning (fastest)</option>
                <option value="fast">Fast</option>
                <option value="balanced">Balanced</option>
                <option value="quality">Quality (slowest)</option>
              </select>
            </div>
          </div>

          <div className="action-row">
            <button type="button" className="btn-accent" onClick={generateImages} disabled={!state.selectedCheckpoint}>
              Generate Character Portraits
            </button>
            <button type="button" className="btn-ghost" onClick={() => setState(s => ({ ...s, phase: "revealed" }))}>
              Back to Descriptions
            </button>
          </div>
        </div>
      )}

      {/* ─── Phase: Generating Images ─── */}
      {state.phase === "generating_images" && !state.loading && (
        <div className="generating-phase">
          <p>Generating character portraits...</p>
        </div>
      )}

      {/* ─── Phase: Image Review ─── */}
      {state.phase === "image_review" && (
        <div className="image-review-phase">
          <h3>Character Portraits</h3>
          <p>Approve each portrait, or select multiple to regenerate together.</p>

          <div className="image-gallery">
            {Object.entries(state.generatedImages).map(([role, img]) => (
              <div key={role} className={`image-card ${img.approved ? "image-approved" : ""}${rerollSelected.includes(role) ? " image-selected-reroll" : ""}`}>
                <div className="image-card-header">
                  {!img.approved && (
                    <label className="reroll-checkbox">
                      <input
                        type="checkbox"
                        checked={rerollSelected.includes(role)}
                        onChange={() => toggleRerollSelect(role)}
                      />
                    </label>
                  )}
                  <h4>{role} {img.approved && <span className="approved-badge">✓ Approved</span>}</h4>
                </div>
                <img
                  src={`data:image/png;base64,${img.image_base64}`}
                  alt={`${role} character portrait`}
                  className="character-portrait"
                />
                <div className="image-meta">
                  <span>Seed: {img.seed}</span>
                  {img.reroll_count > 0 && <span>Rerolls: {img.reroll_count}</span>}
                </div>
                <div className="image-actions">
                  {!img.approved && (
                    <>
                      <button type="button" className="btn-primary btn-sm" onClick={() => approveImage(role)}>
                        Approve
                      </button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => redoImage(role)} disabled={state.loading}>
                        Regenerate
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Inline model switcher */}
          {state.availableModels && (
            <div className="inline-model-switch">
              <details>
                <summary className="model-switch-toggle">Change model / quality</summary>
                <div className="inline-model-form">
                  <div className="form-group-inline">
                    <label>Checkpoint</label>
                    <select
                      value={state.selectedCheckpoint}
                      onChange={e => setState(s => ({ ...s, selectedCheckpoint: e.target.value }))}
                    >
                      {state.availableModels.checkpoints.map(cp => (
                        <option key={cp} value={cp}>{cp}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group-inline">
                    <label>LoRA</label>
                    <select
                      value={state.selectedLora}
                      onChange={e => setState(s => ({ ...s, selectedLora: e.target.value }))}
                    >
                      <option value="none">None</option>
                      {state.availableModels.loras.map(lr => (
                        <option key={lr} value={lr}>{lr}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group-inline">
                    <label>Quality</label>
                    <select
                      value={state.selectedQuality}
                      onChange={e => setState(s => ({ ...s, selectedQuality: e.target.value }))}
                    >
                      <option value="lightning">Lightning</option>
                      <option value="fast">Fast</option>
                      <option value="balanced">Balanced</option>
                      <option value="quality">Quality</option>
                    </select>
                  </div>
                </div>
              </details>
            </div>
          )}

          <div className="action-row">
            {rerollSelected.length > 0 && (
              <button type="button" className="btn-ghost" onClick={batchRedoImages} disabled={state.loading}>
                Regenerate {rerollSelected.length} Selected
              </button>
            )}
            {allImagesApproved && (
              <button type="button" className="btn-accent" onClick={lockImages}>
                Lock Character Images →
              </button>
            )}
            {!allImagesApproved && rerollSelected.length === 0 && (
              <p className="hint-text">Approve all character portraits to lock them.</p>
            )}
          </div>
        </div>
      )}

      {/* ─── Phase: Locked ─── */}
      {state.phase === "locked" && (
        <div className="locked-phase">
          <h3>Character Images Locked! ✓</h3>
          <p>Visual identities have been saved. These will be used as references for scene generation.</p>
          <button type="button" className="btn-ghost" onClick={resetAll}>Start New Session</button>
        </div>
      )}

      <button type="button" className="psych-toggle" onClick={() => setShowPsych((v) => !v)}>
        {showPsych ? "Hide" : "Show"} Psychology
      </button>
      <button type="button" className="insights-toggle" onClick={() => setShowInsights((v) => !v)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
        Insights
      </button>
      <PsychologyOverlay
        fetchPsychology={fetchPsych}
        projectId={projectId}
        visible={showPsych}
        onClose={() => setShowPsych(false)}
      />
      <EngineInsights
        module="character_image"
        projectId={projectId}
        fetchInsights={fetchInsights}
        visible={showInsights}
        onClose={() => setShowInsights(false)}
      />
    </div>
  );
}
