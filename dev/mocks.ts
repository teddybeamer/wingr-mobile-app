import type { SuggestedReply, VibeCheck } from "../types/wingr";

// Mock conversation results for the dev previews (no backend involved).
export const MOCK_VIBE_CHECK: VibeCheck = {
  bestTone: "playful",
  conversationEnergy: "Dry but recoverable",
  interestLevel: "Medium",
  risk: "Low, but reply wisely",
  // Long on purpose: closed it truncates to one line, open it shows in full.
  summary:
    "The energy is definitely there, but the replies are getting shorter. She is still engaging and asking questions back, so a playful, low-pressure message that keeps things light will land best.",
};

export const MOCK_REPLIES: SuggestedReply[] = [
  {
    id: "reply-playful",
    text: "Damn... You’re slowly becoming my favorite notification",
    tone: "playful",
  },
  {
    id: "reply-casual",
    text: "Haha okay, what are you up to this weekend?",
    tone: "casualSmallTalk",
  },
  {
    id: "reply-direct",
    text: "I’m free Saturday. Dinner, you pick the place?",
    tone: "direct",
  },
];
