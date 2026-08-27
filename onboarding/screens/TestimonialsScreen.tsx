import { Image, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeInLeft, FadeInRight } from "react-native-reanimated";
import { OnboardingScreenScaffold } from "./OnboardingScreenScaffold";
import type { OnboardingScreenProps } from "../types/onboarding";

const FIRST_TESTIMONIAL_ENTRANCE = FadeInLeft.duration(420)
  .delay(100)
  .easing(Easing.out(Easing.cubic));
const SECOND_TESTIMONIAL_ENTRANCE = FadeInRight.duration(420)
  .delay(190)
  .easing(Easing.out(Easing.cubic));
const SOCIAL_PROOF_ENTRANCE = FadeInLeft.duration(420)
  .delay(280)
  .easing(Easing.out(Easing.cubic));

const testimonials = [
  {
    author: "Dylan",
    quote: "Bruh I got a gf because of\nthe lines 😭✌️",
    rotation: "-4deg",
  },
  {
    author: "Anonymous WiNGR user",
    quote: "It landed me a date 😹😹👍",
    rotation: "4deg",
  },
];

export function TestimonialsScreen(props: OnboardingScreenProps) {
  return (
    <OnboardingScreenScaffold {...props}>
      <View style={styles.content}>
        <View style={styles.cards}>
          {testimonials.map((testimonial, index) => (
            <Animated.View
              entering={index === 0 ? FIRST_TESTIMONIAL_ENTRANCE : SECOND_TESTIMONIAL_ENTRANCE}
              key={testimonial.author}
              style={styles.cardEntrance}
            >
              <View style={[styles.cardRotation, { transform: [{ rotate: testimonial.rotation }] }]}>
                <View style={styles.card}>
                  <Text style={styles.quote}>{testimonial.quote}</Text>
                  <Text style={styles.author}>{testimonial.author}</Text>
                </View>
              </View>
            </Animated.View>
          ))}
        </View>

        <Animated.View entering={SOCIAL_PROOF_ENTRANCE} style={styles.socialProof}>
          <View accessibilityLabel="Five stars" style={styles.stars}>
            {Array.from({ length: 5 }).map((_, index) => (
              <Text key={index} style={styles.star}>★</Text>
            ))}
          </View>
          <Text style={styles.socialProofText}>
            Loved by thousands of people{"\n"}getting better replies.
          </Text>
          <Image
            accessible={false}
            pointerEvents="none"
            source={require("../../assets/images/underline.png")}
            style={styles.underline}
          />
        </Animated.View>
      </View>
    </OnboardingScreenScaffold>
  );
}

const styles = StyleSheet.create({
  author: {
    color: "#D4D4D4",
    fontFamily: "ClashGroteskRegular",
    fontSize: 14,
    lineHeight: 18,
    width: "100%",
  },
  card: {
    backgroundColor: "#262626",
    borderRadius: 10,
    gap: 4,
    paddingHorizontal: 30,
    paddingVertical: 20,
    width: "100%",
  },
  cardEntrance: {
    width: "100%",
  },
  cardRotation: {
    position: "relative",
    width: "100%",
  },
  cards: {
    gap: 52,
    paddingHorizontal: 8,
    width: "100%",
  },
  content: {
    alignItems: "center",
    gap: 62,
    width: "100%",
  },
  quote: {
    color: "#FFFFFF",
    fontFamily: "ClashDisplay",
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 25,
  },
  socialProof: {
    alignItems: "center",
    gap: 12,
  },
  socialProofText: {
    color: "#FFFFFF",
    fontFamily: "ClashGroteskRegular",
    fontSize: 14,
    lineHeight: 17,
    textAlign: "center",
  },
  star: {
    color: "#1970FD",
    fontSize: 27,
    lineHeight: 27,
  },
  stars: {
    flexDirection: "row",
    gap: 5,
  },
  underline: {
    height: 14,
    marginTop: -10,
    width: 158,
  },
});
