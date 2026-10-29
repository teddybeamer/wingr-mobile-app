import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { getBreakpoints } from "../lib/responsive";

type WidthOverride = { width: number };

// The dev preview harness provides a width here so breakpoints can be checked
// at 320/375/390/430 without a matching device. Production never provides it.
const WidthOverrideContext = createContext<WidthOverride | null>(null);

export function ResponsiveOverrideProvider({
  children,
  width,
}: {
  children: ReactNode;
  width: number | null;
}) {
  const value = useMemo(() => (width === null ? null : { width }), [width]);
  return (
    <WidthOverrideContext.Provider value={value}>
      {children}
    </WidthOverrideContext.Provider>
  );
}

// Breakpoint flags only. Do not derive sizes from width: type, button heights
// and touch targets stay constant, and layout adapts through flex.
export function useBreakpoints() {
  const { height, width: windowWidth } = useWindowDimensions();
  const override = useContext(WidthOverrideContext);
  const width = override?.width ?? windowWidth;
  return { ...getBreakpoints(width, height), height, width };
}
