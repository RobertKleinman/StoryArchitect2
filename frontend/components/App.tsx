import React, { useCallback, useEffect, useState } from "react";
import { HookWorkshop } from "./HookWorkshop";
import { CharacterWorkshop } from "./CharacterWorkshop";
import { CharacterImageWorkshop } from "./CharacterImageWorkshop";
import { WorldWorkshop } from "./WorldWorkshop";
import { PlotWorkshop } from "./PlotWorkshop";
import { SceneWorkshop } from "./SceneWorkshop";
import { ModelSettings } from "./ModelSettings";

type Module = "hook" | "character" | "character_image" | "world" | "plot" | "scene";

const ALL_MODULES: Module[] = ["hook", "character", "character_image", "world", "plot", "scene"];

/** Workshops dispatch these events when their phase changes to locked / active / reset */
export function emitModuleStatus(module: Module, status: "locked" | "active" | "idle") {
  window.dispatchEvent(new CustomEvent("module-status", { detail: { module, status } }));
}

export function App() {
  const [activeModule, setActiveModule] = useState<Module>("hook");
  const [showSettings, setShowSettings] = useState(false);
  const [moduleStatus, setModuleStatus] = useState<Record<Module, "locked" | "active" | "idle">>({
    hook: "idle", character: "idle", character_image: "idle", world: "idle", plot: "idle", scene: "idle",
  });

  const handleStatusEvent = useCallback((e: Event) => {
    const { module, status } = (e as CustomEvent).detail;
    if (ALL_MODULES.includes(module)) {
      setModuleStatus((prev) => ({ ...prev, [module]: status }));
    }
  }, []);

  useEffect(() => {
    window.addEventListener("module-status", handleStatusEvent);
    return () => window.removeEventListener("module-status", handleStatusEvent);
  }, [handleStatusEvent]);

  const tabDot = (mod: Module) => {
    if (moduleStatus[mod] === "locked") return <span className="tab-lock-dot" />;
    if (moduleStatus[mod] === "active") return <span className="tab-progress-dot" />;
    return null;
  };

  return (
    <div className="app-shell">
      <nav className="module-nav">
        <button
          type="button"
          className={`module-tab${activeModule === "hook" ? " module-tab-active" : ""}`}
          onClick={() => setActiveModule("hook")}
        >
          1. Hook {tabDot("hook")}
        </button>
        <button
          type="button"
          className={`module-tab${activeModule === "character" ? " module-tab-active" : ""}`}
          onClick={() => setActiveModule("character")}
        >
          2. Characters {tabDot("character")}
        </button>
        <button
          type="button"
          className={`module-tab${activeModule === "character_image" ? " module-tab-active" : ""}`}
          onClick={() => setActiveModule("character_image")}
        >
          3. Char Images {tabDot("character_image")}
        </button>
        <button
          type="button"
          className={`module-tab${activeModule === "world" ? " module-tab-active" : ""}`}
          onClick={() => setActiveModule("world")}
        >
          4. World {tabDot("world")}
        </button>
        <button
          type="button"
          className={`module-tab${activeModule === "plot" ? " module-tab-active" : ""}`}
          onClick={() => setActiveModule("plot")}
        >
          5. Plot {tabDot("plot")}
        </button>
        <button
          type="button"
          className={`module-tab${activeModule === "scene" ? " module-tab-active" : ""}`}
          onClick={() => setActiveModule("scene")}
        >
          6. Scenes {tabDot("scene")}
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
