export const REVENUECAT_PRO_ENTITLEMENT_LOOKUP_KEY = "pro";
export const REVENUECAT_VERIFICATION_TIMEOUT_MS = 5_000;

const REVENUECAT_API_BASE_URL = "https://api.revenuecat.com/v2";
const MAX_REVENUECAT_PAGES = 10;

export type RevenueCatSubscriptionPlan = "weekly" | "monthly";

export type RevenueCatAccess =
  | { hasActivePro: false }
  | { hasActivePro: true; plan: RevenueCatSubscriptionPlan };

export type RevenueCatVerificationOperation =
  | "configuration"
  | "active_entitlements"
  | "customer_list_confirmation"
  | "subscriptions";

export type RevenueCatVerificationCategory =
  | "authentication"
  | "configuration"
  | "network"
  | "pagination"
  | "permissions"
  | "project_mismatch"
  | "resource_not_found"
  | "response_parsing"
  | "response_semantics"
  | "timeout_or_abort"
  | "upstream_response";

export type RevenueCatEntitlementVerifier = {
  verifyAccess(
    appUserId: string,
    signal?: AbortSignal,
  ): Promise<RevenueCatAccess>;
};

export class RevenueCatVerificationError extends Error {
  constructor(
    public readonly reason:
      | "configuration"
      | "malformed"
      | "timeout"
      | "unavailable",
    public readonly upstreamStatus?: number,
    public readonly upstreamErrorType?: string,
    public readonly upstreamErrorCode?: string,
    public readonly operation?: RevenueCatVerificationOperation,
    public readonly category?: RevenueCatVerificationCategory,
  ) {
    super("RevenueCat entitlement verification is unavailable.");
    this.name = "RevenueCatVerificationError";
  }
}

function httpFailureCategory(
  operation: RevenueCatVerificationOperation,
  status: number,
): RevenueCatVerificationCategory {
  if (status === 401) return "authentication";
  if (status === 403) return "permissions";
  if (status === 404)
    return operation === "customer_list_confirmation"
      ? "project_mismatch"
      : "resource_not_found";
  return "upstream_response";
}

type ActiveEntitlement = {
  entitlementId: string;
};

type CustomerSubscription = {
  givesAccess: boolean;
  id: string;
  productId: string | null;
  proEntitlementIds: string[];
};

function nonEmpty(value: string) {
  return value.trim().length > 0;
}

function safeMachineReadableErrorField(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{1,100}$/.test(value)
    ? value
    : undefined;
}

async function revenueCatErrorMetadata(response: Response) {
  try {
    const payload = await response.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload)
    )
      return {};
    const error = payload as { type?: unknown; code?: unknown };
    return {
      type: safeMachineReadableErrorField(error.type),
      code: safeMachineReadableErrorField(error.code),
    };
  } catch {
    return {};
  }
}

function parseRevenueCatListEnvelope(value: unknown) {
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
    (list.next_page !== undefined &&
      list.next_page !== null &&
      typeof list.next_page !== "string") ||
    typeof list.url !== "string"
  ) {
    throw new RevenueCatVerificationError("malformed");
  }

  return {
    items: list.items,
    next_page: typeof list.next_page === "string" ? list.next_page : null,
    object: "list" as const,
    url: list.url,
  };
}

function parseActiveEntitlementList(value: unknown) {
  const list = parseRevenueCatListEnvelope(value);

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

  const nextCursor =
    list.next_page === null ? null : items.at(-1)?.entitlementId;
  if (list.next_page !== null && !nextCursor) {
    throw new RevenueCatVerificationError("malformed");
  }
  return { items, nextCursor };
}

function parseSubscriptionEntitlementIds(value: unknown) {
  const list = parseRevenueCatListEnvelope(value);
  if (list.next_page !== null) {
    // Plan classification must not depend on a partial entitlement list.
    throw new RevenueCatVerificationError(
      "malformed",
      undefined,
      undefined,
      undefined,
      undefined,
      "pagination",
    );
  }

  return list.items.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new RevenueCatVerificationError("malformed");
    }
    const entitlement = item as { id?: unknown; object?: unknown };
    if (
      entitlement.object !== "entitlement" ||
      typeof entitlement.id !== "string" ||
      !nonEmpty(entitlement.id)
    ) {
      throw new RevenueCatVerificationError("malformed");
    }
    return entitlement.id;
  });
}

function parseCustomerSubscriptionList(value: unknown) {
  const list = parseRevenueCatListEnvelope(value);
  const items: CustomerSubscription[] = list.items.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new RevenueCatVerificationError("malformed");
    }
    const subscription = item as {
      entitlements?: unknown;
      gives_access?: unknown;
      id?: unknown;
      object?: unknown;
      product_id?: unknown;
    };
    if (
      subscription.object !== "subscription" ||
      typeof subscription.id !== "string" ||
      !nonEmpty(subscription.id) ||
      !(
        subscription.product_id === null ||
        (typeof subscription.product_id === "string" &&
          nonEmpty(subscription.product_id))
      ) ||
      typeof subscription.gives_access !== "boolean"
    ) {
      throw new RevenueCatVerificationError("malformed");
    }

    return {
      givesAccess: subscription.gives_access,
      id: subscription.id,
      productId: subscription.product_id,
      proEntitlementIds: parseSubscriptionEntitlementIds(
        subscription.entitlements,
      ),
    };
  });

  const nextCursor = list.next_page === null ? null : items.at(-1)?.id;
  if (list.next_page !== null && !nextCursor) {
    throw new RevenueCatVerificationError("malformed");
  }
  return { items, nextCursor };
}

export function createRevenueCatEntitlementVerifier({
  apiKey,
  fetchImpl = fetch,
  monthlyProductResourceId,
  proEntitlementResourceId,
  projectId,
  timeoutMs = REVENUECAT_VERIFICATION_TIMEOUT_MS,
  weeklyProductResourceId,
}: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  monthlyProductResourceId: string;
  proEntitlementResourceId: string;
  projectId: string;
  timeoutMs?: number;
  weeklyProductResourceId: string;
}): RevenueCatEntitlementVerifier {
  return {
    async verifyAccess(appUserId, signal) {
      const resolvedApiKey = apiKey.trim();
      const resolvedMonthlyProductId = monthlyProductResourceId.trim();
      const resolvedProjectId = projectId.trim();
      const resolvedEntitlementId = proEntitlementResourceId.trim();
      const resolvedAppUserId = appUserId.trim();
      const resolvedWeeklyProductId = weeklyProductResourceId.trim();
      if (
        !resolvedApiKey ||
        !resolvedProjectId ||
        !resolvedEntitlementId ||
        !resolvedAppUserId ||
        !resolvedWeeklyProductId ||
        !resolvedMonthlyProductId ||
        resolvedWeeklyProductId === resolvedMonthlyProductId ||
        !Number.isFinite(timeoutMs) ||
        timeoutMs <= 0
      ) {
        throw new RevenueCatVerificationError(
          "configuration",
          undefined,
          undefined,
          undefined,
          "configuration",
          "configuration",
        );
      }

      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const timer = setTimeout(abort, timeoutMs);
      let currentOperation: RevenueCatVerificationOperation =
        "active_entitlements";

      try {
        const headers = {
          accept: "application/json",
          authorization: `Bearer ${resolvedApiKey}`,
        };
        const getJson = async (
          operation: RevenueCatVerificationOperation,
          url: URL,
        ) => {
          currentOperation = operation;
          const response = await fetchImpl(url, {
            headers,
            signal: controller.signal,
          });
          if (!response.ok) {
            const metadata = await revenueCatErrorMetadata(response);
            throw new RevenueCatVerificationError(
              "unavailable",
              response.status,
              metadata.type,
              metadata.code,
              operation,
              httpFailureCategory(operation, response.status),
            );
          }
          try {
            return await response.json();
          } catch {
            throw new RevenueCatVerificationError(
              "malformed",
              undefined,
              undefined,
              undefined,
              operation,
              "response_parsing",
            );
          }
        };
        const confirmProjectIsReadable = async () => {
          const url = new URL(
            `${REVENUECAT_API_BASE_URL}/projects/${encodeURIComponent(resolvedProjectId)}/customers`,
          );
          url.searchParams.set("limit", "1");
          parseRevenueCatListEnvelope(
            await getJson("customer_list_confirmation", url),
          );
        };

        let hasActivePro = false;
        let entitlementCursor: string | undefined;
        for (let page = 0; page < MAX_REVENUECAT_PAGES; page++) {
          const url = new URL(
            `${REVENUECAT_API_BASE_URL}/projects/${encodeURIComponent(resolvedProjectId)}/customers/${encodeURIComponent(resolvedAppUserId)}/active_entitlements`,
          );
          url.searchParams.set("limit", "100");
          if (entitlementCursor) {
            url.searchParams.set("starting_after", entitlementCursor);
          }

          let payload: unknown;
          try {
            payload = await getJson("active_entitlements", url);
          } catch (failure) {
            if (
              failure instanceof RevenueCatVerificationError &&
              failure.upstreamStatus === 404 &&
              failure.upstreamErrorType === "resource_missing"
            ) {
              await confirmProjectIsReadable();
              return { hasActivePro: false };
            }
            throw failure;
          }

          const entitlements = parseActiveEntitlementList(payload);
          hasActivePro ||= entitlements.items.some(
            ({ entitlementId }) => entitlementId === resolvedEntitlementId,
          );
          if (!entitlements.nextCursor) break;
          if (entitlements.nextCursor === entitlementCursor) {
            throw new RevenueCatVerificationError(
              "malformed",
              undefined,
              undefined,
              undefined,
              "active_entitlements",
              "pagination",
            );
          }
          entitlementCursor = entitlements.nextCursor;
          if (page === MAX_REVENUECAT_PAGES - 1) {
            throw new RevenueCatVerificationError(
              "malformed",
              undefined,
              undefined,
              undefined,
              "active_entitlements",
              "pagination",
            );
          }
        }

        if (!hasActivePro) return { hasActivePro: false };

        const activeProProductIds = new Set<string>();
        let subscriptionCursor: string | undefined;
        for (let page = 0; page < MAX_REVENUECAT_PAGES; page++) {
          const url = new URL(
            `${REVENUECAT_API_BASE_URL}/projects/${encodeURIComponent(resolvedProjectId)}/customers/${encodeURIComponent(resolvedAppUserId)}/subscriptions`,
          );
          url.searchParams.set("limit", "100");
          if (subscriptionCursor) {
            url.searchParams.set("starting_after", subscriptionCursor);
          }
          const subscriptions = parseCustomerSubscriptionList(
            await getJson("subscriptions", url),
          );
          for (const subscription of subscriptions.items) {
            if (
              subscription.givesAccess &&
              subscription.proEntitlementIds.includes(resolvedEntitlementId)
            ) {
              if (!subscription.productId) {
                throw new RevenueCatVerificationError("malformed");
              }
              activeProProductIds.add(subscription.productId);
            }
          }
          if (!subscriptions.nextCursor) break;
          if (subscriptions.nextCursor === subscriptionCursor) {
            throw new RevenueCatVerificationError(
              "malformed",
              undefined,
              undefined,
              undefined,
              "subscriptions",
              "pagination",
            );
          }
          subscriptionCursor = subscriptions.nextCursor;
          if (page === MAX_REVENUECAT_PAGES - 1) {
            throw new RevenueCatVerificationError(
              "malformed",
              undefined,
              undefined,
              undefined,
              "subscriptions",
              "pagination",
            );
          }
        }

        if (
          [...activeProProductIds].some(
            (productId) =>
              productId !== resolvedWeeklyProductId &&
              productId !== resolvedMonthlyProductId,
          )
        ) {
          throw new RevenueCatVerificationError("malformed");
        }

        // A simultaneously access-granting Weekly and Monthly subscription is
        // classified as Weekly so a plan transition never grants the larger cap.
        if (activeProProductIds.has(resolvedWeeklyProductId)) {
          return { hasActivePro: true, plan: "weekly" };
        }
        if (activeProProductIds.has(resolvedMonthlyProductId)) {
          return { hasActivePro: true, plan: "monthly" };
        }
        throw new RevenueCatVerificationError("malformed");
      } catch (failure) {
        if (failure instanceof RevenueCatVerificationError) {
          if (failure.operation && failure.category) throw failure;
          throw new RevenueCatVerificationError(
            failure.reason,
            failure.upstreamStatus,
            failure.upstreamErrorType,
            failure.upstreamErrorCode,
            failure.operation ?? currentOperation,
            failure.category ??
              (failure.reason === "malformed"
                ? "response_semantics"
                : "upstream_response"),
          );
        }
        throw new RevenueCatVerificationError(
          controller.signal.aborted ? "timeout" : "unavailable",
          undefined,
          undefined,
          undefined,
          currentOperation,
          controller.signal.aborted ? "timeout_or_abort" : "network",
        );
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}
