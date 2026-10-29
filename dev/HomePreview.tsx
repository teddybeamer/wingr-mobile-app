import { useState } from "react";

import { HomeScreen } from "../screens/HomeScreen";

export function HomePreview({
  animated = false,
  showStartConversation,
}: {
  animated?: boolean;
  showStartConversation: boolean;
}) {
  const [revealToken, setRevealToken] = useState<number | null>(
    animated ? 1 : null,
  );

  return (
    <HomeScreen
      onAccountDeleted={async () => {}}
      onGetReplies={() => {}}
      onRevealStarted={(token) =>
        setRevealToken((current) => (current === token ? null : current))
      }
      revealToken={revealToken}
      showStartConversation={showStartConversation}
    />
  );
}
