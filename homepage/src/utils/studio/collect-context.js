import { createContext } from "react";

// Chart history (collect.js): inside a collection, a widget's Container hands
// its values to this callback instead of drawing them.
export const CollectContext = createContext(null);
