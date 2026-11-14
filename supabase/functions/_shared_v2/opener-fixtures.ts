// Test data for the Start Conversation contract.
export const profileScreenshot = "data:image/png;base64,iVBORw0KGgo=";

export const starterOpeners = {
  angle: {
    summary:
      "They’re clearly not afraid to share their guilty pleasures, and the Ikea joke says they don’t take themselves too seriously.",
    topics: ["Ikea", "Ice cream", "Lazy Sundays"],
    yourMove:
      "Challenge their ice cream taste or ask which Ikea bed is worth getting kicked out for.",
  },
  openers: [
    {
      tone: "playful" as const,
      text: "Bold of you to plan our Ikea ban before we’ve even met. Which bed are we testing first?",
    },
  ],
};

export const anotherOpener = {
  angle: null,
  openers: [
    {
      tone: "direct" as const,
      text: "Your profile sold me on the Ikea plan. When are we going?",
    },
  ],
};
