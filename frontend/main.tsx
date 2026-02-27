import React from "react";
import { createRoot } from "react-dom/client";
import { HookWorkshop } from "./components/HookWorkshop";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HookWorkshop />
  </React.StrictMode>
);
