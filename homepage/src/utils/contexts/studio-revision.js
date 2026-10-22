import { createContext } from "react";

// Changes only when the native file bytes change, never on moves or slide ticks.
export const StudioRevisionContext = createContext(null);
