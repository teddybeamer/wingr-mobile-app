import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { posthog } from "../../lib/posthog";
import { OnboardingScreenScaffold } from "./OnboardingScreenScaffold";
import type { OnboardingScreenProps } from "../types/onboarding";

export function PaywallScreen(props: OnboardingScreenProps) {
  const [selectedPlan, setSelectedPlan] = useState<"weekly" | "monthly">(
    "monthly",
  );

  return (
    <OnboardingScreenScaffold {...props}>
      <View style={styles.plans}>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: selectedPlan === "weekly" }}
          onPress={() => { setSelectedPlan("weekly"); posthog.capture('paywall_plan_selected', { plan: 'weekly' }); }}
          style={[styles.planCard, selectedPlan === "weekly" && styles.selectedPlan]}
        >
          <Text style={styles.planName}>Weekly Plan</Text>
          <View style={styles.priceCopy}>
            <Text style={styles.price}>$4.99/week</Text>
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: selectedPlan === "monthly" }}
          onPress={() => { setSelectedPlan("monthly"); posthog.capture('paywall_plan_selected', { plan: 'monthly' }); }}
          style={[
            styles.planCard,
            styles.monthlyPlan,
            selectedPlan === "monthly" && styles.selectedPlan,
          ]}
        >
          <View>
            <Text style={styles.planName}>Monthly Plan</Text>
            <Text style={styles.yearMeta}>52 weeks • $49.99</Text>
          </View>
          <View style={styles.priceCopy}>
            <Text style={styles.price}>$2.30/week</Text>
            <Text style={styles.saveBadge}>Save 54%</Text>
          </View>
        </Pressable>
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
    borderColor: "transparent",
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 72,
    paddingHorizontal: 20,
  },
  planName: {
    color: "#FFFFFF",
    fontFamily: "ClashGrotesk",
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 20,
  },
  plans: {
    gap: 10,
  },
  monthlyPlan: {
    minHeight: 78,
  },
  price: {
    color: "#FFFFFF",
    fontFamily: "ClashGrotesk",
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 20,
    textAlign: "right",
  },
  priceCopy: {
    alignItems: "flex-end",
    gap: 4,
  },
  saveBadge: {
    alignSelf: "flex-end",
    backgroundColor: "#1970FD",
    borderRadius: 8,
    color: "#FFFFFF",
    fontFamily: "ClashGroteskRegular",
    fontSize: 12,
    lineHeight: 14,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  selectedPlan: {
    borderColor: "#1970FD",
  },
  yearMeta: {
    color: "#C7C7C7",
    fontFamily: "ClashGroteskRegular",
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 18,
    marginTop: 4,
  },
});
