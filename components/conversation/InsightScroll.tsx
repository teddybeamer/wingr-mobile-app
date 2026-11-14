import { createContext, useContext } from "react";

// Lets an insight card ask the screen around it to glide it to the top, for
// example when it is opened (Start Conversation's The Angle). Screens that do
// not want this provide nothing, and the card does not scroll.
export const InsightScrollContext = createContext<(() => void) | null>(null);

export function useInsightScroll() {
  return useContext(InsightScrollContext);
}
