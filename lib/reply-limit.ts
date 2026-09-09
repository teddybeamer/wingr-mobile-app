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
  let message = "You’ve reached your reply limit. Please check back later.";
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
    message = `You’ve reached your reply limit. You’ll get more replies on ${day} at ${time}.`;
  }
  return {
    title: "Reply limit reached",
    message,
    primaryLabel: "Got it",
    dismiss: true,
  };
}
