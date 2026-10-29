import type { ReactNode } from "react";

import { ChoosePreview } from "./ChoosePreview";
import { ChosenPreview } from "./ChosenPreview";
import { ErrorDialogPreview } from "./ErrorDialogPreview";
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
  {
    id: "error-unreadable",
    title: "Error dialog · can't read screenshot",
    render: () => <ErrorDialogPreview reason="unreadable_image" />,
  },
  {
    id: "error-no-conversation",
    title: "Error dialog · no readable conversation",
    render: () => <ErrorDialogPreview reason="no_conversation" />,
  },
  {
    id: "error-context",
    title: "Error dialog · need more context",
    render: () => <ErrorDialogPreview reason="ownership_unclear" />,
  },
  {
    id: "error-unknown",
    title: "Error dialog · couldn't analyze",
    render: () => <ErrorDialogPreview reason="unknown" />,
  },
  {
    id: "error-tips",
    title: "Error dialog · screenshot tips",
    render: () => <ErrorDialogPreview initialPage="tips" reason="unknown" />,
  },
  {
    id: "error-onboarding",
    title: "Error dialog · onboarding (Choose New Screenshot)",
    render: () => <ErrorDialogPreview onboarding reason="unreadable_image" />,
  },
];
