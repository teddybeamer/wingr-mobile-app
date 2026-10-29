import {
  AltArrowRight,
  ChatRound,
  Play,
} from "@solar-icons/react-native/Linear";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Image,
  type ImageSourcePropType,
  Pressable,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { HomeMoreSheet } from "../components/HomeMoreSheet";
import { MoreButton } from "../components/MoreButton";
import { ScreenHeader } from "../components/ScreenHeader";
import { WingrLogoMark } from "../components/WingrLogoMark";
import { START_CONVERSATION_ENABLED } from "../lib/feature-flags";
import {
  colors,
  iconSizes,
  layout,
  radii,
  spacing,
  surfaces,
  typography,
} from "../theme";

const START_CONVERSATION_IMAGE = require("../assets/images/redesign/home/start-conversation-card.jpg");
const GET_REPLIES_IMAGE = require("../assets/images/redesign/home/get-replies-card.jpg");

// Cards are squares that fill the width between the page gutters (the same
// edge as the header controls). When two squares do not fit the screen height,
// the cards share it instead and the photo crops.
const SHARED_CARD_MIN_HEIGHT = 220;
const REVEAL_STAGGER_MS = 70;

export function HomeScreen({
  onAccountDeleted,
  onGetReplies,
  onRevealStarted,
  revealToken,
  showStartConversation = START_CONVERSATION_ENABLED,
}: {
  onAccountDeleted: () => Promise<void>;
  onGetReplies: () => void;
  onRevealStarted: (revealToken: number) => void;
  revealToken: number | null;
  showStartConversation?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  // Estimate until the scroll area reports its real size.
  const [viewport, setViewport] = useState({
    height: windowHeight - insets.top - insets.bottom - layout.headerHeight,
    width: windowWidth,
  });
  const [isMoreVisible, setIsMoreVisible] = useState(false);
  const [isInteractive, setIsInteractive] = useState(revealToken === null);
  const reveals = useRef([
    new Animated.Value(1),
    new Animated.Value(1),
  ]).current;
  const preparedTokenRef = useRef<number | null>(null);
  const startedTokenRef = useRef<number | null>(null);
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const frameRef = useRef<number | null>(null);

  // Hide the cards before first paint when the entry animation is pending.
  useLayoutEffect(() => {
    if (revealToken === null || preparedTokenRef.current === revealToken) {
      return;
    }
    animationRef.current?.stop();
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    preparedTokenRef.current = revealToken;
    reveals.forEach((value) => value.setValue(0));
    setIsInteractive(false);
  }, [revealToken, reveals]);

  useEffect(
    () => () => {
      animationRef.current?.stop();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const startReveal = () => {
    if (
      revealToken === null ||
      preparedTokenRef.current !== revealToken ||
      startedTokenRef.current === revealToken
    ) {
      return;
    }
    startedTokenRef.current = revealToken;
    onRevealStarted(revealToken);

    animationRef.current = Animated.stagger(
      REVEAL_STAGGER_MS,
      reveals.map((value) =>
        Animated.spring(value, {
          friction: 11,
          tension: 150,
          toValue: 1,
          useNativeDriver: true,
        }),
      ),
    );
    animationRef.current.start(({ finished }) => {
      if (finished) setIsInteractive(true);
    });
  };

  // The photo is the heaviest asset, so the reveal starts once it has loaded.
  const handleImageReady = () => {
    if (revealToken === null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      startReveal();
    });
  };

  const handleViewportLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const { height, width } = nativeEvent.layout;
    setViewport((current) =>
      Math.abs(current.height - height) < 0.5 &&
      Math.abs(current.width - width) < 0.5
        ? current
        : { height, width },
    );
  };

  const cardCount = showStartConversation ? 2 : 1;
  const cardSide = Math.max(0, viewport.width - layout.pageGutter * 2);
  const squaresHeight =
    cardCount * cardSide + (cardCount - 1) * spacing.xl + spacing.xl;
  const shareHeight = squaresHeight > viewport.height;

  const getRevealStyle = (value: Animated.Value) => ({
    opacity: value.interpolate({
      extrapolate: "clamp",
      inputRange: [0, 1],
      outputRange: [0, 1],
    }),
    transform: [
      {
        translateY: value.interpolate({
          inputRange: [0, 1],
          outputRange: [10, 0],
        }),
      },
      {
        scale: value.interpolate({
          inputRange: [0, 1],
          outputRange: [0.94, 1],
        }),
      },
    ],
  });

  return (
    <View style={styles.screen}>
      <ScreenHeader
        center={<WingrLogoMark size={30} />}
        right={
          <MoreButton
            expanded={isMoreVisible}
            onPress={() => setIsMoreVisible(true)}
          />
        }
      />
      <HomeMoreSheet
        onAccountDeleted={onAccountDeleted}
        onClose={() => setIsMoreVisible(false)}
        visible={isMoreVisible}
      />

      <ScrollView
        bounces={false}
        contentContainerStyle={styles.cards}
        onLayout={handleViewportLayout}
        showsVerticalScrollIndicator={false}
      >
        {showStartConversation ? (
          <HomeCard
            accent={colors.blue400}
            shareHeight={shareHeight}
            disabled
            icon={<Play color={colors.blue400} size={iconSizes.lg} />}
            image={START_CONVERSATION_IMAGE}
            revealStyle={getRevealStyle(reveals[0])}
            subtitleAccent="UPLOAD THEIR PROFILE."
            subtitleRest="WE’LL HELP YOU BREAK THE ICE."
            title="Start Conversation"
          />
        ) : null}
        <HomeCard
          accent={colors.teal400}
          shareHeight={shareHeight}
          disabled={!isInteractive}
          icon={<ChatRound color={colors.teal400} size={iconSizes.lg} />}
          image={GET_REPLIES_IMAGE}
          onImageReady={handleImageReady}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
              () => {},
            );
            onGetReplies();
          }}
          revealStyle={getRevealStyle(reveals[1])}
          subtitleAccent="UPLOAD A CHAT SCREENSHOT."
          subtitleRest="GET THE PERFECT REPLY."
          title="Get Replies"
        />
      </ScrollView>
    </View>
  );
}

function HomeCard({
  accent,
  shareHeight,
  disabled,
  icon,
  image,
  onImageReady,
  onPress,
  revealStyle,
  subtitleAccent,
  subtitleRest,
  title,
}: {
  accent: string;
  shareHeight: boolean;
  disabled: boolean;
  icon: ReactNode;
  image: ImageSourcePropType;
  onImageReady?: () => void;
  onPress?: () => void;
  revealStyle: object;
  subtitleAccent: string;
  subtitleRest: string;
  title: string;
}) {
  const [pressed, setPressed] = useState(false);

  // The slot owns the width; the card inside takes its aspect ratio from it.
  // (aspectRatio next to maxWidth on one node derives the height before the
  // clamp, which gave 328 x 358 cards.)
  return (
    <View style={[styles.cardSlot, shareHeight && styles.cardSlotShared]}>
      <Animated.View
        style={[
          styles.cardShadow,
          shareHeight ? StyleSheet.absoluteFill : styles.card,
          revealStyle,
        ]}
      >
        <View style={[styles.cardClip, pressed && styles.cardPressed]}>
          <Image
            accessibilityIgnoresInvertColors
            onError={onImageReady}
            onLoad={onImageReady}
            resizeMode="cover"
            source={image}
            style={styles.cardImage}
          />
          <Svg height="100%" style={StyleSheet.absoluteFill} width="100%">
            <Defs>
              <LinearGradient id="home-card-fade" x1="0" x2="0" y1="0" y2="1">
                <Stop offset="0" stopColor={colors.stone800} stopOpacity={0} />
                <Stop offset="1" stopColor={colors.stone800} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect fill="url(#home-card-fade)" height="100%" width="100%" />
          </Svg>

          <View style={styles.cardTop}>
            <View style={styles.iconChip}>
              <BlurView
                intensity={10}
                style={[StyleSheet.absoluteFill, styles.iconChipBlur]}
                tint="dark"
              />
              <View style={styles.iconChipGlyph}>{icon}</View>
            </View>
          </View>

          <View pointerEvents="none" style={styles.titleLayer}>
            <View style={styles.titleRow}>
              <Text
                maxFontSizeMultiplier={1.2}
                numberOfLines={1}
                style={styles.title}
              >
                {title}
              </Text>
              <AltArrowRight color={colors.stone100} size={iconSizes.lg} />
            </View>
          </View>

          <View style={styles.cardBottom}>
            <Text maxFontSizeMultiplier={1.2} style={styles.subtitle}>
              <Text style={{ color: accent }}>{subtitleAccent}</Text>
              {"\n"}
              {subtitleRest}
            </Text>
          </View>
        </View>
        {/* Touch layer only: the visuals above use plain static styles. */}
        <Pressable
          accessibilityLabel={`${title}. ${subtitleAccent} ${subtitleRest}`}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled || !onPress}
          onPress={onPress}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    aspectRatio: 1,
    width: "100%",
  },
  cardBottom: {
    bottom: 0,
    left: 0,
    padding: spacing.xl,
    position: "absolute",
    right: 0,
  },
  // Fills the card explicitly: the card's height comes from aspectRatio/flex,
  // and a flex:1 child would collapse to its in-flow content (the icon chip).
  cardClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  cardImage: {
    height: "134.81%",
    left: 0,
    position: "absolute",
    top: "-21.1%",
    width: "100%",
  },
  cardPressed: { opacity: 0.92 },
  cardSlot: {
    width: "100%",
  },
  cardSlotShared: {
    flex: 1,
    minHeight: SHARED_CARD_MIN_HEIGHT,
  },
  cardShadow: {
    backgroundColor: colors.stone800,
    borderRadius: radii.lg,
    elevation: 4,
    shadowColor: "#000000",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
  },
  cardTop: { padding: spacing.xl },
  cards: {
    flexGrow: 1,
    gap: spacing.xl,
    justifyContent: "center",
    paddingBottom: spacing.xl,
    paddingHorizontal: layout.pageGutter,
  },
  iconChipBlur: { borderRadius: radii.pill },
  // Positioned so the glyph always paints above the absolutely placed blur.
  iconChipGlyph: { position: "relative", zIndex: 1 },
  iconChip: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: surfaces.iconChip,
    borderRadius: radii.pill,
    height: 48,
    justifyContent: "center",
    overflow: "hidden",
    width: 48,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  subtitle: {
    ...typography.body,
    color: colors.stone200,
  },
  title: {
    ...typography.h1,
    color: colors.stone50,
    flexShrink: 1,
  },
  titleLayer: {
    bottom: 0,
    justifyContent: "center",
    left: 0,
    paddingHorizontal: spacing.xl,
    position: "absolute",
    right: 0,
    top: 0,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
