// Start Conversation needs the ai-opener endpoint, which is on staging only. It
// shows in dev and staging builds; production builds hide it until the endpoint
// is deployed to production.
export const START_CONVERSATION_ENABLED =
  __DEV__ || process.env.EXPO_PUBLIC_WINGR_STAGING === "1";
