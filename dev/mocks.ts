import type { ProfileAngle, SuggestedReply, VibeCheck } from "../types/wingr";

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

// Start Conversation: The Angle and the three first openers for the sample
// profile (dev/assets/sample-profile.jpg).
export const MOCK_ANGLE: ProfileAngle = {
  summary:
    "They’re clearly not afraid to share their guilty pleasures. Getting kicked out of Ikea for testing the beds gives off a cozy, slightly cheeky vibe, and suggests they don’t take themselves too seriously.",
  topics: ["Ikea", "Lazy Sundays", "Interior design", "Sleep", "Adventures"],
  yourMove:
    "Pick up the Ikea plan: challenge which bed would get you banned first, or jokingly question their definition of a wild night.",
};

export const MOCK_OPENERS: SuggestedReply[] = [
  {
    id: "opener-playful",
    text: "Bold of you to plan our Ikea ban before we’ve even met. Which bed are we testing first?",
    tone: "playful",
  },
  {
    id: "opener-casual",
    text: "Okay, the Ikea plan is elite. Are you more of a showroom napper or a meatball person?",
    tone: "casualSmallTalk",
  },
  {
    id: "opener-direct",
    text: "I’m in for the Ikea mission. Coffee first, so we can plan our escape route?",
    tone: "direct",
  },
];
