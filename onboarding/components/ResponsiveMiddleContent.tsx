import { type ReactNode, useState } from 'react';
import {
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

type Size = {
  height: number;
  width: number;
};

type ResponsiveMiddleContentProps = {
  children: ReactNode;
  scrollable?: boolean;
};

const MIN_VERTICAL_GAP = 16;

function sizesMatch(current: Size, next: Size) {
  return current.height === next.height && current.width === next.width;
}

export function ResponsiveMiddleContent({
  children,
  scrollable = false,
}: ResponsiveMiddleContentProps) {
  const [viewportSize, setViewportSize] = useState<Size>({ height: 0, width: 0 });
  const [contentSize, setContentSize] = useState<Size>({ height: 0, width: 0 });

  const availableHeight = Math.max(viewportSize.height - MIN_VERTICAL_GAP * 2, 0);
  const availableWidth = viewportSize.width;
  const hasMeasurements =
    availableHeight > 0 &&
    availableWidth > 0 &&
    contentSize.height > 0 &&
    contentSize.width > 0;
  const scale = hasMeasurements
    ? Math.min(
        1,
        availableHeight / contentSize.height,
        availableWidth / contentSize.width,
      )
    : 1;

  const updateSize =
    (setSize: (size: Size) => void, currentSize: Size) =>
    ({ nativeEvent }: LayoutChangeEvent) => {
      const nextSize = {
        height: nativeEvent.layout.height,
        width: nativeEvent.layout.width,
      };

      if (!sizesMatch(currentSize, nextSize)) {
        setSize(nextSize);
      }
    };

  if (scrollable) {
    return (
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.scrollViewport}
      >
        <View style={styles.content}>{children}</View>
      </ScrollView>
    );
  }

  return (
    <View
      onLayout={updateSize(setViewportSize, viewportSize)}
      style={styles.viewport}
    >
      <View
        onLayout={updateSize(setContentSize, contentSize)}
        style={[styles.content, scale < 1 && { transform: [{ scale }] }]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'stretch',
    gap: 22,
    width: '100%',
  },
  scrollContent: {
    alignItems: 'stretch',
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: MIN_VERTICAL_GAP,
  },
  scrollViewport: {
    flex: 1,
    minHeight: 0,
    width: '100%',
  },
  viewport: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 0,
    overflow: 'hidden',
    paddingVertical: MIN_VERTICAL_GAP,
    width: '100%',
  },
});
