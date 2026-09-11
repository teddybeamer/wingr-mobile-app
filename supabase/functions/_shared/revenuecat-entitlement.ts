export const REVENUECAT_PRO_ENTITLEMENT_LOOKUP_KEY = "pro";
export const REVENUECAT_VERIFICATION_TIMEOUT_MS = 5_000;

const REVENUECAT_API_BASE_URL = "https://api.revenuecat.com/v2";
const MAX_ENTITLEMENT_PAGES = 10;

export type RevenueCatEntitlementVerifier = {
  hasActivePro(appUserId: string, signal?: AbortSignal): Promise<boolean>;
};

export class RevenueCatVerificationError extends Error {
  constructor(
    public readonly reason:
      | "configuration"
      | "malformed"
      | "timeout"
      | "unavailable",
    public readonly upstreamStatus?: number,
  ) {
    super("RevenueCat entitlement verification is unavailable.");
    this.name = "RevenueCatVerificationError";
  }
}

type ActiveEntitlement = {
  entitlementId: string;
};

function nonEmpty(value: string) {
  return value.trim().length > 0;
}

function parseActiveEntitlementList(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RevenueCatVerificationError("malformed");
  }

  const list = value as {
    items?: unknown;
    next_page?: unknown;
    object?: unknown;
    url?: unknown;
  };
  if (
    list.object !== "list" ||
    !Array.isArray(list.items) ||
    (list.next_page !== null && typeof list.next_page !== "string") ||
    typeof list.url !== "string"
  ) {
    throw new RevenueCatVerificationError("malformed");
  }

  const items: ActiveEntitlement[] = list.items.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new RevenueCatVerificationError("malformed");
    }
    const entitlement = item as {
      entitlement_id?: unknown;
      expires_at?: unknown;
      object?: unknown;
    };
    if (
      entitlement.object !== "customer.active_entitlement" ||
      typeof entitlement.entitlement_id !== "string" ||
      !nonEmpty(entitlement.entitlement_id) ||
      !(
        entitlement.expires_at === null ||
        (typeof entitlement.expires_at === "number" &&
          Number.isFinite(entitlement.expires_at) &&
          entitlement.expires_at >= 0)
      )
    ) {
      throw new RevenueCatVerificationError("malformed");
    }
    return { entitlementId: entitlement.entitlement_id };
  });

  return {
    items,
    hasNextPage: typeof list.next_page === "string",
  };
}

export function createRevenueCatEntitlementVerifier({
  apiKey,
  fetchImpl = fetch,
  proEntitlementResourceId,
  projectId,
  timeoutMs = REVENUECAT_VERIFICATION_TIMEOUT_MS,
}: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  proEntitlementResourceId: string;
  projectId: string;
  timeoutMs?: number;
}): RevenueCatEntitlementVerifier {
  return {
    async hasActivePro(appUserId, signal) {
      const resolvedApiKey = apiKey.trim();
      const resolvedProjectId = projectId.trim();
      const resolvedEntitlementId = proEntitlementResourceId.trim();
      const resolvedAppUserId = appUserId.trim();
      if (
        !resolvedApiKey ||
        !resolvedProjectId ||
        !resolvedEntitlementId ||
        !resolvedAppUserId ||
        !Number.isFinite(timeoutMs) ||
        timeoutMs <= 0
      ) {
        throw new RevenueCatVerificationError("configuration");
      }

      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const timer = setTimeout(abort, timeoutMs);

      try {
        let startingAfter: string | undefined;
        for (let page = 0; page < MAX_ENTITLEMENT_PAGES; page++) {
          const url = new URL(
            `${REVENUECAT_API_BASE_URL}/projects/${encodeURIComponent(resolvedProjectId)}/customers/${encodeURIComponent(resolvedAppUserId)}/active_entitlements`,
          );
          url.searchParams.set("limit", "100");
          if (startingAfter) {
            url.searchParams.set("starting_after", startingAfter);
          }

          const response = await fetchImpl(url, {
            headers: {
              accept: "application/json",
              authorization: `Bearer ${resolvedApiKey}`,
            },
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new RevenueCatVerificationError(
              "unavailable",
              response.status,
            );
          }

          let payload: unknown;
          try {
            payload = await response.json();
          } catch {
            throw new RevenueCatVerificationError("malformed");
          }
          const entitlements = parseActiveEntitlementList(payload);
          if (
            entitlements.items.some(
              (entitlement) =>
                entitlement.entitlementId === resolvedEntitlementId,
            )
          ) {
            return true;
          }
          if (!entitlements.hasNextPage) return false;

          const nextCursor = entitlements.items.at(-1)?.entitlementId;
          if (!nextCursor || nextCursor === startingAfter) {
            throw new RevenueCatVerificationError("malformed");
          }
          startingAfter = nextCursor;
        }
        throw new RevenueCatVerificationError("malformed");
      } catch (failure) {
        if (failure instanceof RevenueCatVerificationError) throw failure;
        throw new RevenueCatVerificationError(
          controller.signal.aborted ? "timeout" : "unavailable",
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}
