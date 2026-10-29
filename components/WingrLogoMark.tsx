import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { colors } from "../theme";

// Home header mark, drawn from assets/images/redesign/home/logo-mark.svg.
export function WingrLogoMark({ size = 30 }: { size?: number }) {
  return (
    <Svg
      accessibilityLabel="Wingr"
      accessibilityRole="image"
      height={size}
      viewBox="0 0 30 30"
      width={size}
    >
      <Defs>
        <LinearGradient
          gradientUnits="userSpaceOnUse"
          id="wingr-logo-mark-fill"
          x1="15"
          x2="15"
          y1="0"
          y2="30"
        >
          <Stop offset="0" stopColor={colors.primaryBlue} />
          <Stop offset="1" stopColor={colors.blue900} />
        </LinearGradient>
      </Defs>
      <Rect
        fill="url(#wingr-logo-mark-fill)"
        height={30}
        rx={9.55414}
        width={30}
      />
      <Path
        d="M21.1745 19.7676C21.5994 19.7408 22.4048 19.5977 22.8176 18.8408C23.3388 17.8853 24.9023 11.2403 24.9023 9.80709C24.9023 8.37385 24.3955 8.11294 23.8166 7.89613C23.2377 7.67932 19.9 7.34159 18.8219 8.20004C17.7439 9.0585 18.3642 13.0511 17.8665 13.021C17.3687 12.9909 16.3898 10.3717 15 10.3717C13.6102 10.3717 12.6313 12.9909 12.1335 13.021C11.6357 13.0511 12.2561 9.0585 11.178 8.20004C10.1 7.34159 6.76234 7.67932 6.18344 7.89613C5.60454 8.11294 5.09766 8.37385 5.09766 9.80709C5.09766 11.2403 6.66118 17.8853 7.18236 18.8408C7.70354 19.7963 8.31157 19.7963 8.4853 19.8398C8.65903 19.8832 10.57 19.8398 12.1335 19.8398C13.6971 19.8398 14.7287 16.0178 15 16.0178C15.2713 16.0178 16.3029 19.8398 17.8665 19.8398C18.6646 19.8398 19.0755 19.8535 19.7774 19.8588L21.5147 22.3246L21.5186 19.759L21.1745 19.7676ZM21.1745 19.7676C21.063 19.7746 20.9778 19.7737 20.9326 19.7737L21.1745 19.7676Z"
        fill="none"
        stroke={colors.neutral50}
        strokeWidth={1.17188}
      />
    </Svg>
  );
}
