import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  INITIAL_CHAT_STATE,
  LOADING_CHAT_MESSAGES,
  advanceChat,
  getChatStepDelay,
  type ChatState,
} from "../../lib/loading-chat";
import { colors, layout, radii, spacing, typography } from "../../theme";
import { ScreenHeader } from "../ScreenHeader";
import { WingrLogoMark } from "../WingrLogoMark";

const BANNER_IMAGE = require("../../assets/images/redesign/loading/banner.png");

// Figma: banner 304 x 89 inside the card; avatar and one-line bubble are 39.
const BANNER_ASPECT_RATIO = 304 / 89;
const AVATAR_SIZE = 39;
const BUBBLE_RADIUS = 10;

function formatChatTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Drives the chat described in lib/loading-chat. `times[i]` is the clock time
// shown under slot i; it is taken when that slot's typing indicator appears and
// kept when the indicator becomes the message.
function useLoadingChat() {
  const [state, setState] = useState<ChatState>(INITIAL_CHAT_STATE);
  const timesRef = useRef<string[]>([formatChatTime(new Date())]);

  useEffect(() => {
    const delay = getChatStepDelay(state);
    if (delay === null) return;

    const timer = setTimeout(() => {
      const next = advanceChat(state);
      if (
        (next.phase === "indicator" || next.phase === "waiting") &&
        timesRef.current[next.shown] === undefined
      ) {
        timesRef.current[next.shown] = formatChatTime(new Date());
      }
      setState(next);
    }, delay);
    return () => clearTimeout(timer);
  }, [state]);

  return { state, times: timesRef.current };
}

// Used by the main flow and by onboarding's Vibe Check while a screenshot is
// being read. A chat card: WiNGR "types" a few messages, each one starting as a
// typing indicator that turns into the message, and ends on the indicator until
// the answer is ready. The card fills the width between the page gutters and
// the messages scroll inside it when the screen is too short for all of them.
export function ReplyLoadingScreen() {
  const { state, times } = useLoadingChat();
  const scrollRef = useRef<ScrollView>(null);
  const doneCount = state.shown;
  const typingIndex = state.phase === "typing" ? state.shown : null;
  // The finished messages plus the slot being typed (or the indicator).
  const slotCount = doneCount + 1;
  const typedLetters = state.phase === "typing" ? state.typed : 0;

  return (
    <View style={styles.screen}>
      <ScreenHeader />
      <View style={styles.area}>
        <View
          accessibilityLabel="WiNGR is reading your screenshot"
          accessible
          style={styles.card}
        >
          <View style={styles.banner}>
            <Image
              accessibilityIgnoresInvertColors
              resizeMode="cover"
              source={BANNER_IMAGE}
              style={styles.bannerImage}
            />
          </View>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.chat}
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: true })
            }
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            style={styles.scroll}
          >
            {Array.from({ length: slotCount }, (_, index) => {
              const isDone = index < doneCount;
              const isTyping = index === typingIndex;
              const text = LOADING_CHAT_MESSAGES[index];
              return (
                <ChatRow
                  key={index}
                  text={isDone || isTyping ? text : null}
                  time={times[index] ?? ""}
                  typed={isDone ? text.length : isTyping ? typedLetters : 0}
                />
              );
            })}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

// One slot of the chat: the typing indicator (text === null) or a message. The
// whole message is laid out from the start with the not-yet-typed part
// invisible, so the bubble keeps its final size while it is typed.
function ChatRow({
  text,
  time,
  typed,
}: {
  text: string | null;
  time: string;
  typed: number;
}) {
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(appear, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [appear]);

  return (
    <Animated.View
      style={[
        styles.row,
        {
          opacity: appear,
          transform: [
            {
              translateY: appear.interpolate({
                inputRange: [0, 1],
                outputRange: [6, 0],
              }),
            },
            {
              scale: appear.interpolate({
                inputRange: [0, 1],
                outputRange: [0.94, 1],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.message}>
        <WingrLogoMark size={AVATAR_SIZE} />
        <View style={[styles.bubble, text !== null && styles.bubbleMessage]}>
          {text === null ? (
            <TypingDots />
          ) : (
            <Text maxFontSizeMultiplier={1.2} style={styles.messageText}>
              {text.slice(0, typed)}
              <Text style={styles.untyped}>{text.slice(typed)}</Text>
            </Text>
          )}
        </View>
      </View>
      <View style={styles.timeRow}>
        <Text maxFontSizeMultiplier={1.2} style={styles.time}>
          {time}
        </Text>
      </View>
    </Animated.View>
  );
}

// ". . ." as a wave: each dot brightens a moment after the one before it.
function TypingDots() {
  const dots = useRef([
    new Animated.Value(0.35),
    new Animated.Value(0.35),
    new Animated.Value(0.35),
  ]).current;

  useEffect(() => {
    const wave = Animated.loop(
      Animated.stagger(
        160,
        dots.map((dot) =>
          Animated.sequence([
            Animated.timing(dot, {
              duration: 260,
              toValue: 1,
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              duration: 260,
              toValue: 0.35,
              useNativeDriver: true,
            }),
          ]),
        ),
      ),
    );
    wave.start();
    return () => wave.stop();
  }, [dots]);

  return (
    <View style={styles.dots}>
      {dots.map((opacity, index) => (
        <Animated.Text
          key={index}
          maxFontSizeMultiplier={1.2}
          style={[styles.dot, { opacity }]}
        >
          .
        </Animated.Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  area: {
    flex: 1,
    paddingBottom: layout.pageGutter,
    paddingHorizontal: layout.pageGutter,
  },
  // The aspect ratio sits on a wrapper (an Image ignores it on some platforms)
  // and the picture fills it.
  banner: {
    aspectRatio: BANNER_ASPECT_RATIO,
    borderRadius: spacing.lg,
    overflow: "hidden",
    width: "100%",
  },
  bannerImage: { height: "100%", width: "100%" },
  bubble: {
    backgroundColor: colors.stone800,
    borderBottomLeftRadius: BUBBLE_RADIUS,
    borderBottomRightRadius: BUBBLE_RADIUS,
    borderTopRightRadius: BUBBLE_RADIUS,
    justifyContent: "center",
    minHeight: AVATAR_SIZE,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  bubbleMessage: { flex: 1 },
  card: {
    alignSelf: "stretch",
    backgroundColor: colors.stone900,
    borderRadius: radii.lg,
    gap: spacing.lg,
    maxHeight: "100%",
    overflow: "hidden",
    padding: spacing.lg,
  },
  chat: { gap: spacing.lg },
  dot: { ...typography.chatMessage, color: colors.stone500 },
  dots: { flexDirection: "row", gap: spacing.xs },
  message: { flexDirection: "row", gap: spacing.xs },
  messageText: { ...typography.chatMessage, color: colors.stone100 },
  row: { gap: spacing.xxs },
  scroll: { flexGrow: 0, flexShrink: 1 },
  screen: { backgroundColor: colors.background, flex: 1 },
  time: { ...typography.timestamp, color: colors.stone500 },
  timeRow: { alignItems: "flex-end" },
  untyped: { opacity: 0 },
});
