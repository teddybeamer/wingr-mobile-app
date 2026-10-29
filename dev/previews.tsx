import type { ReactNode } from "react";

import { ChoosePreview } from "./ChoosePreview";
import { ChosenPreview } from "./ChosenPreview";
import { FoundationsPreview } from "./FoundationsPreview";
import { HomePreview } from "./HomePreview";
import { PreviewModalPreview } from "./PreviewModalPreview";

export type PreviewEntry = {
  id: string;
  title: string;
  render: () => ReactNode;
};

// Each redesigned screen adds its entry here, rendering the production
// component with mock data. Nothing in this folder is bundled in production
// builds (see the guarded require in App.tsx).
export const PREVIEWS: PreviewEntry[] = [
  {
    id: "foundations",
    title: "Foundations (fonts, colors, assets)",
    render: () => <FoundationsPreview />,
  },
  {
    id: "home",
    title: "Home · both cards",
    render: () => <HomePreview showStartConversation />,
  },
  {
    id: "home-production",
    title: "Home · production (Get Replies only)",
    render: () => <HomePreview showStartConversation={false} />,
  },
  {
    id: "home-reveal",
    title: "Home · entry animation",
    render: () => <HomePreview animated showStartConversation />,
  },
  {
    id: "choose",
    title: "Choose Screenshot",
    render: () => <ChoosePreview />,
  },
  {
    id: "chosen",
    title: "Screenshot Chosen · portrait",
    render: () => <ChosenPreview sample="portrait" />,
  },
  {
    id: "chosen-wide",
    title: "Screenshot Chosen · landscape",
    render: () => <ChosenPreview sample="wide" />,
  },
  {
    id: "chosen-tall",
    title: "Screenshot Chosen · very tall",
    render: () => <ChosenPreview sample="tall" />,
  },
  {
    id: "chosen-none",
    title: "Screenshot Chosen · none selected",
    render: () => <ChosenPreview sample={null} />,
  },
  {
    id: "chosen-error",
    title: "Screenshot Chosen · error message",
    render: () => (
      <ChosenPreview
        errorMessage="WiNGR could not analyze that screenshot. Try again."
        sample="portrait"
      />
    ),
  },
  {
    id: "chosen-reveal",
    title: "Screenshot Chosen · entry animation",
    render: () => <ChosenPreview animated sample="portrait" />,
  },
  {
    id: "preview-modal",
    title: "Screenshot Preview · portrait",
    render: () => <PreviewModalPreview sample="portrait" />,
  },
  {
    id: "preview-modal-wide",
    title: "Screenshot Preview · landscape",
    render: () => <PreviewModalPreview sample="wide" />,
  },
];
