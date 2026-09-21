import * as SplashScreen from "expo-splash-screen";
import LottieView from "lottie-react-native";
import { useCallback, useRef } from "react";
import { StyleSheet, View } from "react-native";

type LaunchSplashProps = {
  onFinish: () => void;
};

export function LaunchSplash({ onFinish }: LaunchSplashProps) {
  const didHideNativeSplash = useRef(false);

  const hideNativeSplash = useCallback(() => {
    if (didHideNativeSplash.current) return;
    didHideNativeSplash.current = true;
    SplashScreen.hide();
  }, []);

  return (
    <View onLayout={hideNativeSplash} style={styles.container}>
      <LottieView
        autoPlay
        loop={false}
        onAnimationFailure={onFinish}
        onAnimationFinish={(isCancelled) => {
          if (!isCancelled) onFinish();
        }}
        resizeMode="cover"
        source={require("../assets/animations/Wingr Splash.json")}
        style={styles.animation}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#1970FD",
    zIndex: 100,
  },
  animation: StyleSheet.absoluteFillObject,
});
