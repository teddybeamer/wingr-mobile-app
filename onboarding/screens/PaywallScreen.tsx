import { StyleSheet, Text, View } from "react-native";
import { OnboardingScreenScaffold } from "./OnboardingScreenScaffold";
import type { OnboardingScreenProps } from "../types/onboarding";

export function PaywallScreen(props: OnboardingScreenProps) {
  return (
    <OnboardingScreenScaffold {...props}>
      <View style={styles.plans}>
        <View style={styles.planCard}>
          <Text style={styles.planName}>Weekly Plan</Text>
          <View style={styles.priceCopy}>
            <Text style={styles.price}>$9.99/week</Text>
            <Text style={styles.trial}>3-day free trial</Text>
          </View>
        </View>

        <View style={[styles.planCard, styles.selectedPlan]}>
          <View>
            <Text style={styles.planName}>Yearly Plan</Text>
            <Text style={styles.yearMeta}>52 weeks • $49.99</Text>
          </View>
          <View style={styles.priceCopy}>
            <Text style={styles.price}>$0.96/week</Text>
            <Text style={styles.trial}>3-day free trial</Text>
            <Text style={styles.saveBadge}>Save 90%</Text>
          </View>
        </View>
      </View>

      <Text style={styles.footer}>No Commitment • Cancel anytime</Text>
    </OnboardingScreenScaffold>
  );
}

const styles = StyleSheet.create({
  footer: {
    color: "#9B9B9B",
    fontFamily: "ClashGroteskRegular",
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 18,
    marginTop: 0,
    textAlign: "center",
  },
  planCard: {
    alignItems: "center",
    backgroundColor: "#252525",
    borderRadius: 32,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 72,
    paddingHorizontal: 20,
  },
  planName: {
    color: "#FFFFFF",
    fontFamily: "ClashGrotesk",
    fontSize: 18,
    fontWeight: "500",
    lineHeight: 22,
  },
  plans: {
    gap: 10,
  },
  price: {
    color: "#FFFFFF",
    fontFamily: "ClashGroteskRegular",
    fontSize: 18,
    fontWeight: "400",
    lineHeight: 22,
    textAlign: "right",
  },
  priceCopy: {
    alignItems: "flex-end",
    gap: 4,
  },
  saveBadge: {
    alignSelf: "flex-end",
    backgroundColor: "#1970FD",
    borderRadius: 999,
    color: "#FFFFFF",
    fontFamily: "ClashGroteskRegular",
    fontSize: 13,
    lineHeight: 16,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  selectedPlan: {
    borderColor: "#1970FD",
    borderWidth: 1,
    minHeight: 96,
  },
  trial: {
    color: "#D3D3D3",
    fontFamily: "ClashGroteskRegular",
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 20,
    textAlign: "right",
  },
  yearMeta: {
    color: "#C7C7C7",
    fontFamily: "ClashGroteskRegular",
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 20,
    marginTop: 8,
  },
});
