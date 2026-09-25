import { listMobilePushDevices, removeMobilePushDevice } from "./pushDevices.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

type PushData = Record<string, string | number | boolean | null>;
type PushCategory = "mail" | "calendar" | "general";

type ExpoPushResponse = {
  status?: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

export type PushDiagnostic = {
  token: string;
  stage: "ticket" | "receipt";
  status: "ok" | "error" | "pending";
  ticketId?: string;
  error?: string;
  message?: string;
};

export type PushDeliveryResult = {
  attempted: number;
  accepted: number;
  failed: number;
  removedInvalidTokens: number;
  receiptChecked: number;
  receiptDelivered: number;
  receiptFailed: number;
  receiptPending: number;
  diagnostics: PushDiagnostic[];
};

function maskPushToken(token: string) {
  if (token.length <= 16) return `${token.slice(0, 4)}…${token.slice(-4)}`;
  return `${token.slice(0, 10)}…${token.slice(-6)}`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logPush(stage: string, details: Record<string, unknown>) {
  console.info(JSON.stringify({ event: stage, ...details }));
}

function warnPush(stage: string, details: Record<string, unknown>) {
  console.warn(JSON.stringify({ event: stage, ...details }));
}

async function fetchReceipts(ids: string[]) {
  const response = await fetch(EXPO_RECEIPTS_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) throw new Error(`Expo push receipt request failed: HTTP ${response.status}`);
  const payload = await response.json() as { data?: Record<string, ExpoPushResponse> };
  return payload.data ?? {};
}

async function waitForReceipts(ids: string[]) {
  const remaining = new Set(ids);
  const receipts: Record<string, ExpoPushResponse> = {};

  for (const waitMs of [750, 1_500, 3_000, 5_000]) {
    if (!remaining.size) break;
    await delay(waitMs);
    const batch = await fetchReceipts([...remaining]);
    for (const id of remaining) {
      const receipt = batch[id];
      if (!receipt) continue;
      receipts[id] = receipt;
      remaining.delete(id);
    }
  }

  return { receipts, pendingIds: [...remaining] };
}

export async function sendPushToUser(input: {
  userId: string;
  title: string;
  body: string;
  data?: PushData;
  badge?: number;
  sound?: string | null;
  channelId?: string;
  category?: PushCategory;
  checkReceipts?: boolean;
  traceId?: string;
}): Promise<PushDeliveryResult> {
  const category = input.category ?? "general";
  const allDevices = await listMobilePushDevices(input.userId);
  const devices = allDevices.filter((device) => {
    if (category === "mail") return device.mailEnabled;
    if (category === "calendar") return device.calendarEnabled;
    return true;
  });

  logPush("PUSH_PREFERENCE_CHECKED", {
    traceId: input.traceId,
    userId: input.userId,
    category,
    registeredDeviceCount: allDevices.length,
    enabledDeviceCount: devices.length,
    preferences: allDevices.map((device) => ({
      token: maskPushToken(device.expoPushToken),
      platform: device.platform,
      mailEnabled: device.mailEnabled,
      calendarEnabled: device.calendarEnabled,
    })),
  });

  if (!allDevices.length) {
    warnPush("PUSH_SKIPPED", { traceId: input.traceId, userId: input.userId, category, reason: "NO_REGISTERED_DEVICES" });
  } else if (!devices.length) {
    warnPush("PUSH_SKIPPED", { traceId: input.traceId, userId: input.userId, category, reason: "CATEGORY_DISABLED_ON_ALL_DEVICES" });
  }

  if (!devices.length) {
    return {
      attempted: 0,
      accepted: 0,
      failed: 0,
      removedInvalidTokens: 0,
      receiptChecked: 0,
      receiptDelivered: 0,
      receiptFailed: 0,
      receiptPending: 0,
      diagnostics: [],
    };
  }

  logPush("PUSH_TOKENS_FOUND", {
    traceId: input.traceId,
    userId: input.userId,
    category,
    tokens: devices.map((device) => maskPushToken(device.expoPushToken)),
  });

  const messages = devices.map((device) => ({
    to: device.expoPushToken,
    title: input.title,
    body: input.body,
    sound: input.sound ?? "default",
    ...(typeof input.badge === "number" ? { badge: input.badge } : {}),
    ...(input.channelId ? { channelId: input.channelId } : {}),
    ...(input.data ? { data: input.data } : {}),
  }));

  logPush("PUSH_REQUEST_SENT", {
    traceId: input.traceId,
    userId: input.userId,
    category,
    messageCount: messages.length,
    kind: input.data?.kind,
  });

  let response: Response;
  try {
    response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
  } catch (error) {
    warnPush("PUSH_FAILED", {
      traceId: input.traceId,
      userId: input.userId,
      category,
      stage: "expo_request",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`Expo push request failed: HTTP ${response.status}`);
    warnPush("PUSH_FAILED", { traceId: input.traceId, userId: input.userId, category, stage: "expo_request", status: response.status, error: error.message });
    throw error;
  }

  const payload = await response.json() as { data?: ExpoPushResponse[] };
  const tickets = payload.data ?? [];
  const diagnostics: PushDiagnostic[] = [];
  const ticketDeviceIndexes = new Map<string, number>();
  let accepted = 0;
  let failed = 0;
  let removedInvalidTokens = 0;

  for (let index = 0; index < devices.length; index += 1) {
    const ticket = tickets[index];
    const device = devices[index]!;
    if (ticket?.status === "ok" && ticket.id) {
      accepted += 1;
      ticketDeviceIndexes.set(ticket.id, index);
      diagnostics.push({ token: maskPushToken(device.expoPushToken), stage: "ticket", status: "ok", ticketId: ticket.id });
      logPush("PUSH_TICKET_RECEIVED", {
        traceId: input.traceId,
        userId: input.userId,
        category,
        token: maskPushToken(device.expoPushToken),
        ticketId: ticket.id,
        status: "ok",
      });
      continue;
    }

    failed += 1;
    const diagnostic: PushDiagnostic = {
      token: maskPushToken(device.expoPushToken),
      stage: "ticket",
      status: "error",
      ...(ticket?.id ? { ticketId: ticket.id } : {}),
      ...(ticket?.details?.error ? { error: ticket.details.error } : {}),
      message: ticket?.message ?? "Expo did not accept this push notification.",
    };
    diagnostics.push(diagnostic);
    warnPush("PUSH_FAILED", {
      traceId: input.traceId,
      userId: input.userId,
      category,
      stage: "ticket",
      ...diagnostic,
    });
    if (ticket?.details?.error === "DeviceNotRegistered") {
      await removeMobilePushDevice(input.userId, device.expoPushToken);
      removedInvalidTokens += 1;
    }
  }

  let receiptChecked = 0;
  let receiptDelivered = 0;
  let receiptFailed = 0;
  let receiptPending = 0;

  if (input.checkReceipts && ticketDeviceIndexes.size) {
    const ids = [...ticketDeviceIndexes.keys()];
    const { receipts, pendingIds } = await waitForReceipts(ids);
    receiptChecked = ids.length;
    receiptPending = pendingIds.length;

    for (const id of ids) {
      const deviceIndex = ticketDeviceIndexes.get(id)!;
      const device = devices[deviceIndex]!;
      const receipt = receipts[id];
      if (!receipt) {
        diagnostics.push({
          token: maskPushToken(device.expoPushToken),
          stage: "receipt",
          status: "pending",
          ticketId: id,
          message: "Expo has not produced a delivery receipt yet. Retry the test shortly.",
        });
        warnPush("PUSH_RECEIPT_RECEIVED", { traceId: input.traceId, userId: input.userId, category, token: maskPushToken(device.expoPushToken), ticketId: id, status: "pending" });
        continue;
      }

      if (receipt.status === "ok") {
        receiptDelivered += 1;
        diagnostics.push({ token: maskPushToken(device.expoPushToken), stage: "receipt", status: "ok", ticketId: id });
        logPush("PUSH_RECEIPT_RECEIVED", { traceId: input.traceId, userId: input.userId, category, token: maskPushToken(device.expoPushToken), ticketId: id, status: "ok" });
        continue;
      }

      receiptFailed += 1;
      const diagnostic: PushDiagnostic = {
        token: maskPushToken(device.expoPushToken),
        stage: "receipt",
        status: "error",
        ticketId: id,
        ...(receipt.details?.error ? { error: receipt.details.error } : {}),
        message: receipt.message ?? "APNs/FCM rejected this push notification.",
      };
      diagnostics.push(diagnostic);
      warnPush("PUSH_FAILED", { traceId: input.traceId, userId: input.userId, category, stage: "receipt", ...diagnostic });
      if (receipt.details?.error === "DeviceNotRegistered") {
        await removeMobilePushDevice(input.userId, device.expoPushToken);
        removedInvalidTokens += 1;
      }
    }
  } else if (ticketDeviceIndexes.size) {
    const ids = [...ticketDeviceIndexes.keys()];
    void waitForReceipts(ids).then(async ({ receipts, pendingIds }) => {
      for (const id of ids) {
        const deviceIndex = ticketDeviceIndexes.get(id)!;
        const device = devices[deviceIndex]!;
        const receipt = receipts[id];
        if (!receipt) continue;
        if (receipt.status === "ok") {
          logPush("PUSH_RECEIPT_RECEIVED", {
            traceId: input.traceId,
            userId: input.userId,
            category,
            token: maskPushToken(device.expoPushToken),
            ticketId: id,
            status: "ok",
          });
          continue;
        }
        warnPush("PUSH_FAILED", {
          traceId: input.traceId,
          userId: input.userId,
          category,
          stage: "receipt",
          token: maskPushToken(device.expoPushToken),
          ticketId: id,
          error: receipt.details?.error,
          message: receipt.message,
        });
        if (receipt.details?.error === "DeviceNotRegistered") {
          await removeMobilePushDevice(input.userId, device.expoPushToken);
        }
      }
      if (pendingIds.length) {
        warnPush("PUSH_RECEIPT_RECEIVED", {
          traceId: input.traceId,
          userId: input.userId,
          category,
          status: "pending",
          count: pendingIds.length,
          ticketIds: pendingIds,
        });
      }
    }).catch((error) => {
      warnPush("PUSH_FAILED", {
        traceId: input.traceId,
        userId: input.userId,
        category,
        stage: "receipt_lookup",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return {
    attempted: devices.length,
    accepted,
    failed,
    removedInvalidTokens,
    receiptChecked,
    receiptDelivered,
    receiptFailed,
    receiptPending,
    diagnostics,
  };
}
