import React, { useState } from "react";
import type { HookPack } from "../../shared/types/hook";
import type { CharacterPack } from "../../shared/types/character";
import type { CharacterImagePack } from "../../shared/types/characterImage";
import type { WorldPack } from "../../shared/types/world";
import type { PlotPack, TensionBeat } from "../../shared/types/plot";
import type { ScenePack } from "../../shared/types/scene";

type AnyPack = HookPack | CharacterPack | CharacterImagePack | WorldPack | PlotPack | ScenePack;

interface PackPreviewProps {
  pack: AnyPack;
  /** Whether to start expanded or collapsed */
  defaultExpanded?: boolean;
}

// ─── Module-specific detail renderers ───

function renderHookDetails(pack: HookPack) {
  return (
    <div className="pack-preview-details">
      {pack.locked.hook_sentence && (
        <div className="pack-field">
          <span className="pack-field-label">Hook</span>
          <p className="pack-field-value pack-hook-sentence">{pack.locked.hook_sentence}</p>
        </div>
      )}
      {pack.locked.emotional_promise && (
        <div className="pack-field">
          <span className="pack-field-label">Emotional Promise</span>
          <p className="pack-field-value">{pack.locked.emotional_promise}</p>
        </div>
      )}
      {pack.locked.premise && (
        <div className="pack-field">
          <span className="pack-field-label">Premise</span>
          <p className="pack-field-value">{pack.locked.premise}</p>
        </div>
      )}
    </div>
  );
}

function renderCharacterDetails(pack: CharacterPack) {
  const characters = pack.locked.characters;
  if (!characters || Object.keys(characters).length === 0) return null;

  return (
    <div className="pack-preview-details">
      <div className="pack-character-grid">
        {Object.entries(characters).map(([role, char]) => (
          <div key={role} className="pack-character-card">
            <div className="pack-character-header">
              <strong>{role}</strong>
            </div>
            <p className="pack-character-desc">{char.description}</p>
          </div>
        ))}
      </div>
      {pack.locked.ensemble_dynamic && (
        <div className="pack-field">
          <span className="pack-field-label">Ensemble Dynamic</span>
          <p className="pack-field-value">{pack.locked.ensemble_dynamic}</p>
        </div>
      )}
    </div>
  );
}

function renderCharacterImageDetails(pack: CharacterImagePack) {
  if (pack.skipped) {
    return (
      <div className="pack-preview-details">
        <p className="pack-skipped-note">Visual design was skipped for this project.</p>
      </div>
    );
  }

  const characters = pack.locked.characters;
  if (!characters || Object.keys(characters).length === 0) return null;

  return (
    <div className="pack-preview-details">
      <div className="pack-character-grid">
        {Object.entries(characters).map(([role, char]) => (
          <div key={role} className="pack-character-card">
            <div className="pack-character-header">
              <strong>{role}</strong>
            </div>
            {char.image_base64 && (
              <img
                className="pack-character-image"
                src={`data:image/png;base64,${char.image_base64}`}
                alt={`${role} portrait`}
              />
            )}
            <p className="pack-character-desc">
              {char.visual_description?.full_body_description?.slice(0, 200)}
              {(char.visual_description?.full_body_description?.length ?? 0) > 200 ? "..." : ""}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderWorldDetails(pack: WorldPack) {
  return (
    <div className="pack-preview-details">
      {pack.locked.arena && (
        <div className="pack-field">
          <span className="pack-field-label">Arena ({pack.locked.arena.locations.length} locations)</span>
          <div className="pack-tag-list">
            {pack.locked.arena.locations.map(loc => (
              <span key={loc.id} className="pack-tag">{loc.name}</span>
            ))}
          </div>
        </div>
      )}
      {pack.locked.factions && pack.locked.factions.length > 0 && (
        <div className="pack-field">
          <span className="pack-field-label">Factions ({pack.locked.factions.length})</span>
          <div className="pack-tag-list">
            {pack.locked.factions.map(f => (
              <span key={f.id} className="pack-tag" title={f.goal}>{f.name}</span>
            ))}
          </div>
        </div>
      )}
      {pack.locked.rules && pack.locked.rules.length > 0 && (
        <div className="pack-field">
          <span className="pack-field-label">Rules ({pack.locked.rules.length})</span>
          <ul className="pack-list">
            {pack.locked.rules.slice(0, 3).map(r => (
              <li key={r.id}>{r.rule}</li>
            ))}
            {pack.locked.rules.length > 3 && (
              <li className="pack-list-more">+{pack.locked.rules.length - 3} more</li>
            )}
          </ul>
        </div>
      )}
      {pack.locked.world_thesis && (
        <div className="pack-field">
          <span className="pack-field-label">World Thesis</span>
          <p className="pack-field-value">{pack.locked.world_thesis}</p>
        </div>
      )}
    </div>
  );
}

function renderPlotDetails(pack: PlotPack) {
  const chain = pack.locked.tension_chain;
  if (!chain || chain.length === 0) return null;

  return (
    <div className="pack-preview-details">
      {pack.locked.core_conflict && (
        <div className="pack-field">
          <span className="pack-field-label">Core Conflict</span>
          <p className="pack-field-value">{pack.locked.core_conflict}</p>
        </div>
      )}
      <div className="pack-field">
        <span className="pack-field-label">Tension Chain ({chain.length} beats)</span>
        <div className="pack-tension-timeline">
          {chain.map((beat: TensionBeat, i: number) => {
            const isTurningPoint = pack.locked.turning_points?.some(tp => tp.beat_id === beat.id);
            return (
              <div
                key={beat.id}
                className={`pack-beat ${isTurningPoint ? "pack-beat-turning" : ""}`}
              >
                <span className="pack-beat-number">{i + 1}</span>
                <div className="pack-beat-content">
                  <span className="pack-beat-text">{beat.beat}</span>
                  <span className="pack-beat-stakes">
                    {"*".repeat(Math.min(beat.stakes_level, 10))}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {pack.locked.theme_cluster && (
        <div className="pack-field">
          <span className="pack-field-label">Theme</span>
          <p className="pack-field-value">{pack.locked.theme_cluster.question}</p>
        </div>
      )}
    </div>
  );
}

function renderSceneDetails(pack: ScenePack) {
  if (!pack.scenes || pack.scenes.length === 0) return null;

  return (
    <div className="pack-preview-details">
      {pack.narrative_preview && (
        <div className="pack-field">
          <span className="pack-field-label">
            {pack.narrative_preview.estimated_scene_count} scenes,
            ~{pack.narrative_preview.estimated_reading_time} min read
          </span>
        </div>
      )}
      <div className="pack-scene-list">
        {pack.scenes.map((scene, i) => (
          <div key={scene.scene_id} className="pack-scene-item">
            <span className="pack-scene-number">{i + 1}</span>
            <span className="pack-scene-title">{scene.builder_output.readable.title}</span>
            <span className="pack-scene-words">{scene.builder_output.readable.word_count}w</span>
            {scene.minor_judge && (
              <span className={`pack-scene-status ${scene.minor_judge.pass ? "pack-status-pass" : "pack-status-fail"}`}>
                {scene.minor_judge.pass ? "OK" : "!"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Module label mapping ───

const MODULE_LABELS: Record<string, string> = {
  hook: "Hook",
  character: "Characters",
  character_image: "Character Images",
  world: "World",
  plot: "Plot",
  scene: "Scenes",
};

// ─── Main Component ───

export function PackPreview({ pack, defaultExpanded = false }: PackPreviewProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const moduleLabel = MODULE_LABELS[pack.module] ?? pack.module;

  // All packs have state_summary
  const summary = (pack as any).state_summary as string | undefined;

  const renderDetails = () => {
    switch (pack.module) {
      case "hook":
        return renderHookDetails(pack as HookPack);
      case "character":
        return renderCharacterDetails(pack as CharacterPack);
      case "character_image":
        return renderCharacterImageDetails(pack as CharacterImagePack);
      case "world":
        return renderWorldDetails(pack as WorldPack);
      case "plot":
        return renderPlotDetails(pack as PlotPack);
      case "scene":
        return renderSceneDetails(pack as ScenePack);
      default:
        return null;
    }
  };

  return (
    <div className="pack-preview">
      <div className="pack-preview-header" onClick={() => setExpanded(e => !e)}>
        <span className="pack-preview-module">{moduleLabel} Pack</span>
        <span className="pack-preview-toggle">{expanded ? "\u25BE" : "\u25B8"}</span>
      </div>

      {summary && (
        <p className="pack-preview-summary">{summary}</p>
      )}

      {expanded && renderDetails()}
    </div>
  );
}
