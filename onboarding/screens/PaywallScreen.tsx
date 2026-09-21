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
import { MoreButton } from "../../components/MoreButton";
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
      bodyStyle={styles.bodyCopy}
      copyStyle={styles.copy}
      ctaDisabled={offeringsLoading || !selectedPackage || busy}
      ctaHeight={44}
      ctaLoading={action === "purchasing"}
      footerContent={
        <View style={styles.footerContent}>
          <View style={styles.footerRow}>
            <Text style={styles.footerText}>No commitment</Text>
            <View style={styles.footerDot} />
            <Text style={styles.footerText}>Cancel anytime</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            hitSlop={8}
            onPress={() => void handleRestore()}
            style={styles.restoreButton}
          >
            <Text
              style={[styles.restoreText, busy && styles.disabledRestoreText]}
            >
              {action === "restoring" ? "Restoring…" : "Restore purchase"}
            </Text>
          </Pressable>
        </View>
      }
      headerAppearance="paywall"
      headerRight={
        props.onMore ? (
          <MoreButton
            expanded={Boolean(props.moreVisible)}
            onPress={props.onMore}
            style={styles.moreButton}
          />
        ) : undefined
      }
      onPrimaryAction={handlePurchase}
      titleStyle={styles.title}
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
          <View style={styles.planCopy}>
            <Text style={styles.planName}>Weekly Plan</Text>
            <Text style={styles.planAllowance}>
              125 replies + vibechecks
            </Text>
          </View>
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
            selectedPlan === "monthly" && styles.selectedPlan,
          ]}
        >
          <View style={styles.planCopy}>
            <Text style={styles.planName}>Monthly Plan</Text>
            <Text style={styles.planAllowance}>
              500 replies + vibechecks
            </Text>
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

    </OnboardingScreenScaffold>
  );
}

const styles = StyleSheet.create({
  bodyCopy: {
    color: "#FFFFFF",
    fontSize: 14,
    lineHeight: 17,
  },
  copy: {
    gap: 8,
  },
  footerContent: {
    alignItems: "center",
    gap: 6,
    marginTop: 18,
  },
  footerDot: {
    backgroundColor: "#D4D4D4",
    borderRadius: 2,
    height: 4,
    width: 4,
  },
  footerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  footerText: {
    color: "#D4D4D4",
    fontFamily: "ClashGrotesk",
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 17,
  },
  planCard: {
    alignItems: "center",
    backgroundColor: "#262626",
    borderColor: "transparent",
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 30,
    paddingVertical: 16,
  },
  planAllowance: {
    color: "#D4D4D4",
    fontFamily: "ClashGrotesk",
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 17,
  },
  planCopy: {
    flex: 1,
    gap: 4,
    paddingRight: 8,
  },
  planName: {
    color: "#FFFFFF",
    fontFamily: "ClashDisplay",
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 20,
  },
  plans: {
    gap: 10,
  },
  moreButton: {
    right: -10,
    top: 0,
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
    justifyContent: "center",
  },
  restoreText: {
    color: "#A3A3A3",
    fontFamily: "ClashGrotesk",
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 17,
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
  title: {
    fontSize: 24,
    lineHeight: 29,
  },
});
