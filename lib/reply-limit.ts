import { parseRetryAt } from "../supabase/functions/_shared/conversation";

export function getReplyErrorPresentation(error: {
  code?: string;
  message: string;
  retryAt?: string;
}) {
  if (error.code !== "usage_limit") {
    return {
      title: "Something went wrong",
      message: error.message,
      primaryLabel: "Try again",
      dismiss: false,
    };
  }
  const retryAt = parseRetryAt(error.retryAt);
  // Use is unlimited; this is the fair use guard (200 generations per 24 hours).
  let message = "You’ve used WiNGR a lot today. Please check back later.";
  if (retryAt) {
    const date = new Date(Math.ceil(Date.parse(retryAt) / 60_000) * 60_000);
    const day = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
    }).format(date);
    const time = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
    message = `You’ve used WiNGR a lot today. You can keep going on ${day} at ${time}.`;
  }
  return {
    title: "Time for a short break",
    message,
    primaryLabel: "Got it",
    dismiss: true,
  };
}
