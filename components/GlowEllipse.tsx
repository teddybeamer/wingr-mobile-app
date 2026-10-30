import { useId } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import Svg, { Defs, Ellipse, FeGaussianBlur, Filter } from "react-native-svg";

// A blurred, optionally rotated ellipse used as a soft light behind a card (the
// Figma "glow" layers). The canvas leaves room for the blur on every side, as in
// the Figma export (2 standard deviations each side); the card that holds it
// clips it. Position it with `style` (left/top or right/bottom of the canvas,
// not of the ellipse).
export function GlowEllipse({
  blur,
  fill,
  opacity = 1,
  rotation = 0,
  rx,
  ry,
  style,
}: {
  blur: number;
  fill: string;
  // Fill opacity of the ellipse itself (Figma: fill-opacity).
  opacity?: number;
  rotation?: number;
  rx: number;
  ry: number;
  style?: StyleProp<ViewStyle>;
}) {
  const id = `glow${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const width = 2 * rx + 4 * blur;
  const height = 2 * ry + 4 * blur;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.glow,
        { height, transform: [{ rotate: `${rotation}deg` }], width },
        style,
      ]}
    >
      <Svg height={height} width={width}>
        <Defs>
          <Filter
            filterUnits="userSpaceOnUse"
            height={height}
            id={id}
            primitiveUnits="userSpaceOnUse"
            width={width}
            x={0}
            y={0}
          >
            <FeGaussianBlur stdDeviation={blur} />
          </Filter>
        </Defs>
        <Ellipse
          cx={width / 2}
          cy={height / 2}
          fill={fill}
          fillOpacity={opacity}
          filter={`url(#${id})`}
          rx={rx}
          ry={ry}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({ glow: { position: "absolute" } });
