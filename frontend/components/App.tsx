import React, { useState } from "react";
import { HookWorkshop } from "./HookWorkshop";
import { CharacterWorkshop } from "./CharacterWorkshop";
import { CharacterImageWorkshop } from "./CharacterImageWorkshop";
import { WorldWorkshop } from "./WorldWorkshop";
import { PlotWorkshop } from "./PlotWorkshop";
import { SceneWorkshop } from "./SceneWorkshop";
import { ModelSettings } from "./ModelSettings";

type Module = "hook" | "character" | "character_image" | "world" | "plot" | "scene";

export function App() {
  const [activeModule, setActiveModule] = useState<Module>("hook");
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="app-shell">
      <nav className="module-nav">
        <button
          type="button"
          className={`module-tab${activeModule === "hook" ? " module-tab-active" : ""}`}
          onClick={() => setActiveModule("hook")}
        >
          1. Hook
        </button>
        <button
          type="button"
          className={`module-tab${activeModule === "character" ? " module-tab-active" : ""}`}
          onClick={() => setActiveModule("character")}
        >
          2. Characters
        </button>
        <button
          type="button"
          className={`module-tab${activeModule === "character_image" ? " module-tab-active" : ""}`}
          onClick={() => setActiveModule("character_image")}
        >
          3. Character Images
        </button>
        <button
          type="button"
          className={`module-tab${activeModule === "world" ? " module-tab-active" : ""}`}
          onClick={() => setActiveModule("world")}
        >
          4. World
        </button>
        <button
          type="button"
          className={`module-tab${activeModule === "plot" ? " module-tab-active" : ""}`}
          onClick={() => setActiveModule("plot")}
        >
          5. Plot
        </button>
        <button
          type="button"
          className={`module-tab${activeModule === "scene" ? " module-tab-active" : ""}`}
          onClick={() => setActiveModule("scene")}
        >
          6. Scenes
        </button>
        <button
          type="button"
          className="module-tab"
          onClick={() => setShowSettings(true)}
          title="Model Settings"
          style={{ marginLeft: "auto", fontSize: "1.1rem" }}
        >
          &#9881; Models
        </button>
      </nav>

      {activeModule === "hook" && <HookWorkshop />}
      {activeModule === "character" && <CharacterWorkshop />}
      {activeModule === "character_image" && <CharacterImageWorkshop />}
      {activeModule === "world" && <WorldWorkshop />}
      {activeModule === "plot" && <PlotWorkshop />}
      {activeModule === "scene" && <SceneWorkshop />}

      {showSettings && <ModelSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
