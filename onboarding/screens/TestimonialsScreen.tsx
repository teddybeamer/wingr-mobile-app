import { StyleSheet, Text, View } from "react-native";
import { OnboardingScreenScaffold } from "./OnboardingScreenScaffold";
import type { OnboardingScreenProps } from "../types/onboarding";

const testimonials = [
  {
    author: "Anonymous WiNGR user",
    quote: "It landed me a date 😹😹👍",
  },
  {
    author: "Dylan",
    quote: "Bruh I got a gf because of the lines 😭✌️",
  },
];

export function TestimonialsScreen(props: OnboardingScreenProps) {
  return (
    <OnboardingScreenScaffold {...props}>
      <View style={styles.cards}>
        {testimonials.map((testimonial) => (
          <View key={testimonial.author} style={styles.card}>
            <Text style={styles.quote}>{testimonial.quote}</Text>
            <Text style={styles.author}>{testimonial.author}</Text>
          </View>
        ))}
      </View>
    </OnboardingScreenScaffold>
  );
}

const styles = StyleSheet.create({
  author: {
    color: "#D4D4D4",
    fontFamily: "ClashDisplay",
    fontSize: 14,
    lineHeight: 18,
    width: "100%",
  },
  card: {
    backgroundColor: "#262626",
    borderRadius: 10,
    gap: 4,
    padding: 16,
    width: "100%",
  },
  cards: {
    gap: 20,
    width: "100%",
  },
  quote: {
    color: "#FFFFFF",
    fontFamily: "ClashDisplay",
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 25,
  },
});
