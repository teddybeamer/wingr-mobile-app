import { useRef } from "react";
import {
  Animated,
  Image,
  type ImageSourcePropType,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";

import { colors } from "../theme";

const FADE_DURATION_MS = 180;

// Shows a dark surface until the image has loaded, then fades it in, so a slow
// decode reads as a soft entrance instead of an empty box that pops.
export function FadeInImage({
  source,
  style,
}: {
  source: ImageSourcePropType;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = useRef(new Animated.Value(0)).current;

  const reveal = () => {
    Animated.timing(opacity, {
      duration: FADE_DURATION_MS,
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={[styles.surface, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
        <Image
          accessibilityIgnoresInvertColors
          onError={reveal}
          onLoad={reveal}
          resizeMode="cover"
          source={source}
          style={styles.image}
        />
      </Animated.View>
    </View>
  );
}

// Keeps the decoded image warm before the screen that shows it mounts. Render
// it at the size the image will have there so the cached bitmap can be reused.
export function PreloadImage({
  height,
  source,
  width,
}: {
  height: number;
  source: ImageSourcePropType;
  width: number;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.preload}
    >
      <Image resizeMode="cover" source={source} style={{ height, width }} />
    </View>
  );
}

const styles = StyleSheet.create({
  image: { height: "100%", width: "100%" },
  preload: { left: 0, opacity: 0, position: "absolute", top: 0 },
  surface: { backgroundColor: colors.stone900 },
});
