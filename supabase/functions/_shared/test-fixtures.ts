export const input = {
  screenshot: "data:image/png;base64,iVBORw0KGgo=",
  selectedTone: "playful" as const,
};
export const result = {
  messages: [
    { speaker: "ME" as const, text: "Kaffe på fredag?" },
    { speaker: "THEM" as const, text: "Haha ja, hvor?" },
  ],
  replyable: true,
  vibeCheck: {
    interestLevel: "High" as const,
    conversationEnergy: "De er med på planen.",
    bestTone: "direct" as const,
    risk: "Hold det enkelt.",
    summary: "Foreslå et sted.",
  },
  replies: ["Skal vi finde en café ved søerne?"],
};
