import type { ReactNode } from "react";

import { FoundationsPreview } from "./FoundationsPreview";

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
];
