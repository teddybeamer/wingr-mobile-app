import * as Haptics from "expo-haptics";

// Fire-and-forget wrappers: haptics must never throw into a press handler or
// delay it (some devices and simulators have no haptic engine).

// A light tap, as soon as a finger touches a control.
export function tapHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// A firmer tap for the main action ("Get New Reply").
export function pressHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

// "It worked": a reply was copied, or a new reply arrived.
export function successHaptic() {
  void Haptics.notificationAsync(
    Haptics.NotificationFeedbackType.Success,
  ).catch(() => {});
}
