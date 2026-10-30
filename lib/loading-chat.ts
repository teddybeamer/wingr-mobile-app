// The loading screen is a small chat: a typing indicator ("...") shows for a
// moment, becomes a message that is typed out letter by letter, then a new
// indicator appears for the next message. After the last message the indicator
// stays until the answer arrives. This file is the pure timeline; the screen
// only runs timers and draws it.

export const LOADING_CHAT_MESSAGES = [
  "Hey man",
  "Let’s cook something up...",
  "Reading the vibe...",
  "Finding your opening...",
  "Trust the process...",
  "Yep. This is the one...",
] as const;

// How long the typing indicator shows before the first message, and before
// each later one.
export const FIRST_INDICATOR_MS = 1000;
export const NEXT_INDICATOR_MS = 700;
export const TYPING_MS_PER_LETTER = 32;
// Pause after a message is fully typed.
export const HOLD_MS = 600;

export type ChatState =
  // `shown` messages are done; the indicator is about to become message `shown`.
  | { phase: "indicator"; shown: number }
  // Message `shown` is being typed; `typed` of its letters are visible.
  | { phase: "typing"; shown: number; typed: number }
  // Every message is done: the indicator stays until the screen goes away.
  | { phase: "waiting"; shown: number };

export const INITIAL_CHAT_STATE: ChatState = { phase: "indicator", shown: 0 };

// Milliseconds until the next step, or null when the timeline has ended.
export function getChatStepDelay(
  state: ChatState,
  messages: readonly string[] = LOADING_CHAT_MESSAGES,
) {
  switch (state.phase) {
    case "indicator":
      return state.shown === 0 ? FIRST_INDICATOR_MS : NEXT_INDICATOR_MS;
    case "typing":
      return state.typed < messages[state.shown].length
        ? TYPING_MS_PER_LETTER
        : HOLD_MS;
    case "waiting":
      return null;
  }
}

export function advanceChat(
  state: ChatState,
  messages: readonly string[] = LOADING_CHAT_MESSAGES,
): ChatState {
  switch (state.phase) {
    case "indicator":
      return { phase: "typing", shown: state.shown, typed: 0 };
    case "typing": {
      if (state.typed < messages[state.shown].length) {
        return { ...state, typed: state.typed + 1 };
      }
      const shown = state.shown + 1;
      return shown < messages.length
        ? { phase: "indicator", shown }
        : { phase: "waiting", shown };
    }
    case "waiting":
      return state;
  }
}
