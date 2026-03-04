import React, { useState } from "react";
import { HookWorkshop } from "./HookWorkshop";
import { CharacterWorkshop } from "./CharacterWorkshop";
import { CharacterImageWorkshop } from "./CharacterImageWorkshop";

type Module = "hook" | "character" | "character_image";

export function App() {
  const [activeModule, setActiveModule] = useState<Module>("hook");

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
      </nav>

      {activeModule === "hook" && <HookWorkshop />}
      {activeModule === "character" && <CharacterWorkshop />}
      {activeModule === "character_image" && <CharacterImageWorkshop />}
    </div>
  );
}
