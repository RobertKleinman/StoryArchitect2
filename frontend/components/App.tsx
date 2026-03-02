import React, { useState } from "react";
import { HookWorkshop } from "./HookWorkshop";
import { CharacterWorkshop } from "./CharacterWorkshop";

type Module = "hook" | "character";

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
      </nav>

      {activeModule === "hook" && <HookWorkshop />}
      {activeModule === "character" && <CharacterWorkshop />}
    </div>
  );
}
