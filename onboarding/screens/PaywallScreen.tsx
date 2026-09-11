import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { posthog } from "../../lib/posthog";
import {
  getRevenueCatPackage,
  isRevenueCatPurchaseCancelled,
  purchasePlanAndComplete,
  restoreAndComplete,
  type RevenueCatPlan,
} from "../../lib/revenuecat-core";
import {
  getRevenueCatOfferings,
  purchaseRevenueCatPackage,
  restoreRevenueCatPurchases,
} from "../../lib/revenuecat";
import type { PurchasesOffering } from "react-native-purchases";
import { OnboardingScreenScaffold } from "./OnboardingScreenScaffold";
import type { OnboardingScreenProps } from "../types/onboarding";

export function PaywallScreen(props: OnboardingScreenProps) {
  const [selectedPlan, setSelectedPlan] = useState<RevenueCatPlan>("monthly");
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [offeringsLoading, setOfferingsLoading] = useState(true);
  const [action, setAction] = useState<"idle" | "purchasing" | "restoring">(
    "idle",
  );
  const actionInFlight = useRef(false);

  useEffect(() => {
    let mounted = true;

    void getRevenueCatOfferings()
      .then((offerings) => {
        if (mounted) {
          setOffering(offerings.current);
        }
      })
      .catch(() => {
        if (mounted) {
          setOffering(null);
        }
      })
      .finally(() => {
        if (mounted) {
          setOfferingsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const weeklyPackage = offering?.weekly ?? null;
  const monthlyPackage = offering?.monthly ?? null;
  const selectedPackage = offering
    ? getRevenueCatPackage(offering, selectedPlan)
    : null;
  const busy = action !== "idle";

  const handlePurchase = async () => {
    if (!offering || !selectedPackage || actionInFlight.current) {
      return;
    }

    actionInFlight.current = true;
    setAction("purchasing");
    posthog.capture("paywall_purchase_started", { plan: selectedPlan });

    try {
      const unlocked = await purchasePlanAndComplete({
        offering,
        onComplete: props.onComplete,
        plan: selectedPlan,
        purchasePackage: purchaseRevenueCatPackage,
      });

      if (!unlocked) {
        posthog.capture("paywall_purchase_missing_entitlement", {
          plan: selectedPlan,
        });
        Alert.alert(
          "Subscription not active",
          "Your purchase did not activate WiNGR Pro. Please try Restore Purchases or contact support.",
        );
      }
    } catch (failure) {
      if (isRevenueCatPurchaseCancelled(failure)) {
        posthog.capture("paywall_purchase_cancelled", { plan: selectedPlan });
      } else {
        posthog.capture("paywall_purchase_failed", { plan: selectedPlan });
        Alert.alert(
          "Purchase failed",
          "WiNGR could not complete your purchase. Please try again.",
        );
      }
    } finally {
      actionInFlight.current = false;
      setAction("idle");
    }
  };

  const handleRestore = async () => {
    if (actionInFlight.current) {
      return;
    }

    actionInFlight.current = true;
    setAction("restoring");
    posthog.capture("paywall_restore_started");

    try {
      const unlocked = await restoreAndComplete({
        onComplete: props.onComplete,
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
    } finally {
      actionInFlight.current = false;
      setAction("idle");
    }
  };

  return (
    <OnboardingScreenScaffold
      {...props}
      ctaDisabled={offeringsLoading || !selectedPackage || busy}
      ctaLoading={action === "purchasing"}
      onPrimaryAction={handlePurchase}
    >
      <View style={styles.plans}>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: selectedPlan === "weekly" }}
          disabled={!weeklyPackage || busy}
          onPress={() => {
            setSelectedPlan("weekly");
            posthog.capture("paywall_plan_selected", { plan: "weekly" });
          }}
          style={[
            styles.planCard,
            selectedPlan === "weekly" && styles.selectedPlan,
          ]}
        >
          <Text style={styles.planName}>Weekly Plan</Text>
          <View style={styles.priceCopy}>
            <Text style={styles.price}>
              {weeklyPackage
                ? `${weeklyPackage.product.priceString}/week`
                : offeringsLoading
                  ? "Loading…"
                  : "Unavailable"}
            </Text>
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: selectedPlan === "monthly" }}
          disabled={!monthlyPackage || busy}
          onPress={() => {
            setSelectedPlan("monthly");
            posthog.capture("paywall_plan_selected", { plan: "monthly" });
          }}
          style={[
            styles.planCard,
            styles.monthlyPlan,
            selectedPlan === "monthly" && styles.selectedPlan,
          ]}
        >
          <View>
            <Text style={styles.planName}>Monthly Plan</Text>
          </View>
          <View style={styles.priceCopy}>
            <Text style={styles.price}>
              {monthlyPackage
                ? `${monthlyPackage.product.priceString}/month`
                : offeringsLoading
                  ? "Loading…"
                  : "Unavailable"}
            </Text>
            <Text style={styles.saveBadge}>Save 54%</Text>
          </View>
        </Pressable>
      </View>

      <Text style={styles.footer}>No Commitment • Cancel anytime</Text>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void handleRestore()}
        style={styles.restoreButton}
      >
        <Text style={[styles.restoreText, busy && styles.disabledRestoreText]}>
          {action === "restoring" ? "Restoring…" : "Restore Purchases"}
        </Text>
      </Pressable>
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
  restoreButton: {
    alignItems: "center",
    minHeight: 36,
    justifyContent: "center",
  },
  restoreText: {
    color: "#FFFFFF",
    fontFamily: "ClashGrotesk",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
    textDecorationLine: "underline",
  },
  disabledRestoreText: {
    opacity: 0.5,
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
});
