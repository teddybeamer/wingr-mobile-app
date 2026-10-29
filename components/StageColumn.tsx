import { type ReactNode, useState } from "react";
import {
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { layout, radii, spacing } from "../theme";

const STAGE_MIN_HEIGHT = 240;
// Used until the footer reports its real height.
const FOOTER_HEIGHT_ESTIMATE = 160;

// Choose Screenshot and Screenshot Chosen share this body: a stage that fills
// the width between the page gutters (same edges as the header controls) and a
// footer card below it. The stage keeps its 328:394 shape when it fits; on
// shorter screens it takes the remaining height instead, and its contents fit
// themselves to whatever size they get.
export function StageColumn({
  footer,
  stage,
}: {
  footer: ReactNode;
  stage: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  // Estimate until the scroll area reports its real size.
  const [viewport, setViewport] = useState({
    height: windowHeight - insets.top - insets.bottom - layout.headerHeight,
    width: windowWidth,
  });
  const [footerHeight, setFooterHeight] = useState(FOOTER_HEIGHT_ESTIMATE);

  const handleViewportLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { height, width } = nativeEvent.layout;
    setViewport((current) =>
      Math.abs(current.height - height) < 0.5 &&
      Math.abs(current.width - width) < 0.5
        ? current
        : { height, width },
    );
  };

  const handleFooterLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { height } = nativeEvent.layout;
    setFooterHeight((current) =>
      Math.abs(current - height) < 0.5 ? current : height,
    );
  };

  const stageWidth = Math.max(0, viewport.width - layout.pageGutter * 2);
  const squareStageHeight = stageWidth / layout.stageAspectRatio;
  const neededHeight =
    squareStageHeight + spacing.lg + footerHeight + layout.pageGutter;
  const shareHeight = neededHeight > viewport.height;

  return (
    <ScrollView
      bounces={false}
      contentContainerStyle={styles.content}
      onLayout={handleViewportLayout}
      showsVerticalScrollIndicator={false}
    >
      <View style={shareHeight ? styles.stageShared : styles.stage}>
        <View style={styles.stageFrame}>{stage}</View>
      </View>
      <View onLayout={handleFooterLayout}>{footer}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: spacing.lg,
    paddingBottom: layout.pageGutter,
    paddingHorizontal: layout.pageGutter,
  },
  stage: {
    aspectRatio: layout.stageAspectRatio,
    width: "100%",
  },
  stageFrame: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  stageShared: {
    flex: 1,
    minHeight: STAGE_MIN_HEIGHT,
  },
});
