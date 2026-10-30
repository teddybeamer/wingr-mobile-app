import "./global.css";

import { PostHogProvider } from "posthog-react-native";
import { posthog } from "./lib/posthog";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import {
  Component,
  type ComponentType,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AltArrowDown,
  Bolt,
  ChatRound,
  Heart,
  ShieldWarning,
} from "@solar-icons/react-native/Linear";
import {
  Alert,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ReplyTone } from "./types/wingr";
import { OnboardingFlow } from "./onboarding/OnboardingFlow";
import { BackButton } from "./components/BackButton";
import { HomeMoreSheet } from "./components/HomeMoreSheet";
import { useConversationFlow } from "./hooks/useConversationFlow";
import { getReplyErrorPresentation } from "./lib/reply-limit";
import { ReplyLoadingScreen } from "./components/conversation/ReplyLoadingScreen";
import { ScreenshotErrorDialog } from "./components/conversation/ScreenshotErrorDialog";
import {
  getRevenueCatCustomerInfo,
  hasProEntitlement,
  initializeRevenueCat,
  restoreRevenueCatPurchases,
  subscribeToRevenueCatCustomerInfo,
} from "./lib/revenuecat";
import { restoreAndComplete } from "./lib/revenuecat-core";
import { clearAccountLocalState } from "./lib/account-local-state";
import { getSupabaseRequestAuthentication } from "./lib/supabase-auth";
import {
  hasCompletedOnboarding,
  markOnboardingCompleted,
} from "./lib/onboarding-progress";
import {
  resolveLaunchRoute,
  routeForCustomerInfo,
  type LaunchRoute,
} from "./lib/launch-routing";
import { LaunchSplash } from "./components/LaunchSplash";
import { fontFamilies } from "./theme";
import { ChooseScreenshotScreen } from "./screens/ChooseScreenshotScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { RepliesScreen } from "./screens/RepliesScreen";
import { ScreenshotChosenScreen } from "./screens/ScreenshotChosenScreen";

const DEBUG_BOOT_PROBE = false;

// Dev-only UI preview. The require is inside the __DEV__ guard so Metro drops
// the whole ./dev folder from production bundles.
const DevPreviewLauncher: ComponentType | null = __DEV__
  ? require("./dev/DevPreviewLauncher").DevPreviewLauncher
  : null;

if (Platform.OS === "ios") {
  SplashScreen.preventAutoHideAsync().catch(() => {});
}

console.log("[Wingr boot] App module loaded");

const FONTS = {
  display: "ClashDisplay",
  displayMedium: "ClashDisplayMedium",
  body: "ClashGrotesk",
  bodyRegular: "ClashGroteskRegular",
};

const COLORS = {
  background: "#080808",
  blue: "#1970FD",
  white: "#F6F7FB",
  muted: "#B7B7BE",
  border: "#5B5B64",
  panel: "#101010",
  panelRaised: "#151515",
  green: "#21C57A",
  yellow: "#F6B94B",
  red: "#FF5A65",
  purple: "#6552FF",
  orange: "#D66A00",
  teal: "#00B8AF",
  teal700: "#0F766E",
  teal800: "#115E59",
  indigo700: "#4338CA",
  indigo800: "#3730A3",
};

type Screen =
  | "onboarding"
  | "landing"
  | "choose"
  | "upload"
  | "analyzing"
  | "replies";

type BootErrorBoundaryProps = {
  children: ReactNode;
};

type BootErrorBoundaryState = {
  error: Error | null;
};

class BootErrorBoundary extends Component<
  BootErrorBoundaryProps,
  BootErrorBoundaryState
> {
  state: BootErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error(
      "[Wingr boot] Render error boundary caught",
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.debugBootScreen}>
          <Text style={styles.debugBootTitle}>Wingr render error</Text>
          <Text style={styles.debugBootBody}>{this.state.error.message}</Text>
        </View>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const [showLaunchSplash, setShowLaunchSplash] = useState(
    Platform.OS === "ios",
  );

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <WingrApp />
      {DevPreviewLauncher ? <DevPreviewLauncher /> : null}
      {showLaunchSplash ? (
        <LaunchSplash onFinish={() => setShowLaunchSplash(false)} />
      ) : null}
    </SafeAreaProvider>
  );
}

function WingrApp() {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [authenticatedUserId, setAuthenticatedUserId] = useState<string | null>(
    null,
  );
  const [onboardingInitialStep, setOnboardingInitialStep] = useState<
    "paywall" | undefined
  >(undefined);
  const [launchError, setLaunchError] = useState(false);
  const [launchRevision, setLaunchRevision] = useState(0);
  const [onboardingInstance, setOnboardingInstance] = useState(0);
  const [isPaywallMoreVisible, setIsPaywallMoreVisible] = useState(false);
  const [showDebugBootScreen, setShowDebugBootScreen] =
    useState(DEBUG_BOOT_PROBE);
  const landingRevealVersionRef = useRef(0);
  const landingRevealPlayedRef = useRef(false);
  const [landingRevealToken, setLandingRevealToken] = useState<number | null>(
    null,
  );
  const uploadRevealVersionRef = useRef(0);
  const launchGenerationRef = useRef(0);
  const [uploadRevealToken, setUploadRevealToken] = useState<number | null>(
    null,
  );
  const conversation = useConversationFlow("pro");
  const {
    error,
    generatedReplies,
    lastGeneratedReplyId,
    pickScreenshot,
    refreshReplies,
    repliesStatus,
    selectedScreenshotUri,
    selectedTone,
    vibeCheck,
  } = conversation;
  const [fontsLoaded] = useFonts({
    [FONTS.display]: require("./assets/fonts/ClashDisplay-Variable.ttf"),
    [FONTS.displayMedium]: require("./assets/fonts/ClashDisplay-Medium.ttf"),
    [FONTS.body]: require("./assets/fonts/ClashGrotesk-Variable.ttf"),
    [FONTS.bodyRegular]: require("./assets/fonts/ClashGrotesk-Regular.ttf"),
    [fontFamilies.body]: require("./assets/fonts/UncutSans-Medium.otf"),
  });

  useEffect(() => {
    if (error?.kind === "permission")
      Alert.alert("Photo access needed", error.message);
  }, [error?.id]);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    let customerInfoRevision = 0;
    const generation = ++launchGenerationRef.current;

    const commitRoute = (route: LaunchRoute, userId: string) => {
      if (!mounted || launchGenerationRef.current !== generation) return;
      setAuthenticatedUserId(userId);
      setOnboardingInitialStep(route === "paywall" ? "paywall" : undefined);
      setScreen(route === "main" ? "landing" : "onboarding");
      setLaunchError(false);
    };

    const routeUpdatedCustomerInfo = async (
      customerInfo: Parameters<typeof hasProEntitlement>[0],
      userId: string,
    ) => {
      const revision = ++customerInfoRevision;
      const route = await routeForCustomerInfo({
        customerInfo,
        hasProEntitlement,
        hasCompletedOnboarding: () =>
          hasCompletedOnboarding(userId).catch(() => false),
        markOnboardingCompleted: () =>
          markOnboardingCompleted(userId).catch(() => {}),
      });
      if (revision === customerInfoRevision) commitRoute(route, userId);
    };

    void resolveLaunchRoute({
      getAuthentication: getSupabaseRequestAuthentication,
      initializeRevenueCat,
      getCustomerInfo: getRevenueCatCustomerInfo,
      hasProEntitlement,
      hasCompletedOnboarding: (userId) =>
        hasCompletedOnboarding(userId).catch(() => false),
      markOnboardingCompleted: (userId) =>
        markOnboardingCompleted(userId).catch(() => {}),
    })
      .then(({ route, userId }) => {
        if (!mounted || launchGenerationRef.current !== generation) return;
        commitRoute(route, userId);
        unsubscribe = subscribeToRevenueCatCustomerInfo((customerInfo) => {
          void routeUpdatedCustomerInfo(customerInfo, userId).catch(() => {
            // Keep the last authoritative route if only a local marker read fails.
          });
        });
      })
      .catch(() => {
        if (mounted && launchGenerationRef.current === generation) {
          setScreen(null);
          setLaunchError(true);
        }
      });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [launchRevision]);

  console.log("[Wingr boot] App render", {
    fontsLoaded,
    screen,
    showDebugBootScreen,
  });

  useEffect(() => {
    console.log("[Wingr boot] App mounted");

    if (!DEBUG_BOOT_PROBE) {
      return;
    }

    const timeoutId = setTimeout(() => {
      console.log("[Wingr boot] Hiding debug boot screen");
      setShowDebugBootScreen(false);
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    console.log("[Wingr boot] Fonts loaded state changed", fontsLoaded);
  }, [fontsLoaded]);

  if (showDebugBootScreen) {
    return (
      <View style={styles.debugBootScreen}>
        <Text style={styles.debugBootTitle}>Wingr loaded</Text>
        <Text style={styles.debugBootBody}>
          JS mounted. Waiting for app render...
        </Text>
      </View>
    );
  }

  if (!fontsLoaded) {
    console.log("[Wingr boot] Waiting for fonts");
    return (
      <View style={styles.debugBootScreen}>
        <Text style={styles.debugBootTitle}>Wingr loaded</Text>
        <Text style={styles.debugBootBody}>Loading fonts...</Text>
      </View>
    );
  }

  if (screen === null) {
    return (
      <View style={styles.debugBootScreen}>
        <Text style={styles.debugBootTitle}>Wingr</Text>
        <Text style={styles.debugBootBody}>
          {launchError
            ? "Wingr could not verify your subscription. Restart the app to try again."
            : "Loading your account…"}
        </Text>
      </View>
    );
  }

  const handlePickScreenshotForUpload = async () => {
    const screenshotUri = await pickScreenshot();
    if (!screenshotUri) return;

    uploadRevealVersionRef.current += 1;
    setUploadRevealToken(uploadRevealVersionRef.current);
    setScreen("upload");
  };

  const playLandingReveal = () => {
    landingRevealVersionRef.current += 1;
    setLandingRevealToken(landingRevealVersionRef.current);
  };

  const handleEnterLanding = async () => {
    if (authenticatedUserId) {
      await markOnboardingCompleted(authenticatedUserId).catch(() => {});
    }
    if (!landingRevealPlayedRef.current) {
      landingRevealPlayedRef.current = true;
      playLandingReveal();
    }

    setScreen("landing");
  };

  const handlePaywallRestorePurchases = async () => {
    posthog.capture("paywall_restore_started");

    try {
      const unlocked = await restoreAndComplete({
        onComplete: async () => {
          setIsPaywallMoreVisible(false);
          await handleEnterLanding();
        },
        restorePurchases: restoreRevenueCatPurchases,
      });

      if (!unlocked) {
        posthog.capture("paywall_restore_missing_entitlement");
        Alert.alert(
          "No active subscription",
          "We could not find an active WiNGR Pro purchase to restore.",
        );
      }
    } catch {
      posthog.capture("paywall_restore_failed");
      Alert.alert(
        "Restore failed",
        "WiNGR could not restore your purchases. Please try again.",
      );
    }
  };

  const handleCheckSelectedScreenshot = async () => {
    if (__DEV__) {
      console.info("[Wingr flow] check vibe pressed", {
        hasScreenshot: Boolean(selectedScreenshotUri?.trim()),
        platform: Platform.OS,
      });
    }

    if (!selectedScreenshotUri) {
      await handlePickScreenshotForUpload();
      return;
    }

    setScreen("analyzing");
    const result = await conversation.analyzeScreenshot();

    if (result === "cancelled") return;
    if (result === "ready") {
      setScreen("replies");
    } else {
      // The upload screen renders the current error. Reading conversation.error
      // here would use the stale render from before the awaited request.
      setScreen("upload");
    }
  };

  const handleToneChange = async (tone: ReplyTone) => {
    return conversation.changeTone(tone);
  };

  const handleRefreshReplies = async () => {
    return refreshReplies();
  };

  const handleAccountDeleted = async () => {
    launchGenerationRef.current += 1;
    await clearAccountLocalState();
    conversation.reset();
    setAuthenticatedUserId(null);
    setOnboardingInitialStep(undefined);
    setLandingRevealToken(null);
    setUploadRevealToken(null);
    setOnboardingInstance((current) => current + 1);
    setScreen(null);
    setLaunchError(false);
    setLaunchRevision((current) => current + 1);
  };

  return (
    <PostHogProvider
      client={posthog}
      autocapture={{ captureTouches: true, propsToCapture: ["testID"] }}
    >
      <BootErrorBoundary>
        <SafeAreaView style={styles.safeArea}>
          <StatusBar style="light" />
          {screen === "onboarding" && authenticatedUserId ? (
            <OnboardingFlow
              initialStepId={onboardingInitialStep}
              key={onboardingInstance}
              onComplete={handleEnterLanding}
              onMore={() => setIsPaywallMoreVisible(true)}
              moreVisible={isPaywallMoreVisible}
              userId={authenticatedUserId}
            />
          ) : null}
          <HomeMoreSheet
            visible={isPaywallMoreVisible}
            onClose={() => setIsPaywallMoreVisible(false)}
            onAccountDeleted={handleAccountDeleted}
            onRestorePurchases={handlePaywallRestorePurchases}
          />

          {screen === "landing" ? (
            <HomeScreen
              onGetReplies={() => setScreen("choose")}
              onAccountDeleted={handleAccountDeleted}
              onRevealStarted={(revealToken) => {
                setLandingRevealToken((currentToken) =>
                  currentToken === revealToken ? null : currentToken,
                );
              }}
              revealToken={landingRevealToken}
            />
          ) : null}

          {screen === "choose" ? (
            <ChooseScreenshotScreen
              onBack={() => {
                // Home remounts, so replay the staggered card entrance.
                playLandingReveal();
                setScreen("landing");
              }}
              onChooseScreenshot={handlePickScreenshotForUpload}
            />
          ) : null}

          {screen === "upload" ? (
            <ScreenshotChosenScreen
              errorMessage={
                error?.kind === "analysis" &&
                error.errorCode !== "unusable_screenshot"
                  ? getReplyErrorPresentation(error).message
                  : null
              }
              onBack={() => setScreen("choose")}
              onChangeScreenshot={handlePickScreenshotForUpload}
              onGetReplies={handleCheckSelectedScreenshot}
              onRevealStarted={(revealToken) => {
                setUploadRevealToken((currentToken) =>
                  currentToken === revealToken ? null : currentToken,
                );
              }}
              revealToken={uploadRevealToken}
              selectedScreenshotUri={selectedScreenshotUri}
            />
          ) : null}

          {screen === "analyzing" ? <ReplyLoadingScreen /> : null}

          {screen === "replies" && vibeCheck ? (
            <RepliesScreen
              isGeneratingReplies={repliesStatus === "generating"}
              lastGeneratedReplyId={lastGeneratedReplyId}
              onBack={() => {
                setScreen("upload");
              }}
              onRefreshReplies={handleRefreshReplies}
              onToneChange={handleToneChange}
              replies={generatedReplies}
              replyError={
                error?.kind === "replies" &&
                error.errorCode !== "unusable_screenshot"
                  ? error
                  : null
              }
              onDismissReplyError={conversation.clearError}
              selectedScreenshotUri={selectedScreenshotUri}
              vibeCheck={vibeCheck}
              selectedTone={selectedTone}
            />
          ) : null}
          {/* "Got it" just closes: Screenshot Chosen has Change Screenshot. */}
          <ScreenshotErrorDialog error={error} />
        </SafeAreaView>
      </BootErrorBoundary>
    </PostHogProvider>
  );
}

const styles = StyleSheet.create({
  changeScreenshotGradientStroke: {
    left: 0,
    position: "absolute",
    top: 0,
  },
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  debugBootBody: {
    color: "#B7B7BE",
    fontSize: 16,
    lineHeight: 22,
    marginTop: 10,
    textAlign: "center",
  },
  debugBootScreen: {
    alignItems: "center",
    backgroundColor: "#080808",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  debugBootTitle: {
    color: "#F6F7FB",
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
    textAlign: "center",
  },
  logo: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 30,
    textAlign: "center",
  },
  heroImage: {
    alignSelf: "center",
    height: 405,
    marginTop: 36,
    width: "100%",
  },
  uploadSection: {
    gap: 14,
    marginTop: 14,
  },
  sectionTitle: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 27,
    fontWeight: "700",
    lineHeight: 33,
  },
  uploadButton: {
    alignItems: "center",
    backgroundColor: COLORS.panel,
    borderColor: COLORS.border,
    borderRadius: 18,
    borderStyle: "dashed",
    borderWidth: 1,
    height: 160,
    justifyContent: "center",
    overflow: "hidden",
  },
  uploadEmptyState: {
    alignItems: "center",
    gap: 16,
    justifyContent: "center",
  },
  uploadText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 24,
    textAlign: "center",
  },
  uploadSubtext: {
    color: COLORS.muted,
    fontFamily: FONTS.body,
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 20,
    marginTop: 2,
    textAlign: "center",
  },
  plusButton: {
    alignItems: "center",
    borderColor: COLORS.white,
    borderRadius: 7,
    borderWidth: 1,
    height: 21,
    justifyContent: "center",
    width: 21,
  },
  plusText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 18,
    fontWeight: "500",
    lineHeight: 20,
  },
  selectedPreview: {
    height: "100%",
    justifyContent: "center",
    width: "100%",
  },
  selectedImage: {
    opacity: 0.44,
  },
  selectedOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.42)",
    flex: 1,
    justifyContent: "center",
  },
  vibeHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  backButton: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  vibeCard: {
    backgroundColor: COLORS.panelRaised,
    borderRadius: 12,
    gap: 0,
    padding: 10,
  },
  vibeCardTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    marginBottom: 4,
  },
  vibeCardTitle: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 26,
    fontWeight: "700",
    lineHeight: 32,
  },
  vibeSummaryText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 21,
    marginBottom: 6,
  },
  repliesControlsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  toneSelector: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: "#B7B7BE",
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    flexDirection: "row",
    gap: 9,
    height: 40,
    justifyContent: "center",
    paddingHorizontal: 22,
    width: 190,
  },
  toneSelectorText: {
    color: "#E5E5E5",
    fontFamily: FONTS.bodyRegular,
    fontSize: 13,
    lineHeight: 17,
    minWidth: 0,
  },
  replyCards: {
    gap: 14,
    width: "100%",
  },
  repliesLoadingCard: {
    alignItems: "center",
    backgroundColor: "#151515",
    borderColor: "#2B2B2F",
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    minHeight: 164,
    justifyContent: "center",
    padding: 20,
    width: "100%",
  },
  repliesLoadingText: {
    color: "#D6D6DB",
    fontFamily: FONTS.body,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 21,
  },
  newRepliesButton: {
    alignItems: "center",
    backgroundColor: "#454545",
    borderRadius: 999,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    height: 40,
    justifyContent: "center",
  },
  newRepliesButtonText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 20,
  },
});
