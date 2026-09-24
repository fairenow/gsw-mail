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
}): Promise<PushDeliveryResult> {
  const devices = (await listMobilePushDevices(input.userId)).filter((device) => {
    if (input.category === "mail") return device.mailEnabled;
    if (input.category === "calendar") return device.calendarEnabled;
    return true;
  });
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

  const messages = devices.map((device) => ({
    to: device.expoPushToken,
    title: input.title,
    body: input.body,
    sound: input.sound ?? "default",
    ...(typeof input.badge === "number" ? { badge: input.badge } : {}),
    ...(input.channelId ? { channelId: input.channelId } : {}),
    ...(input.data ? { data: input.data } : {}),
  }));

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });
  if (!response.ok) throw new Error(`Expo push request failed: HTTP ${response.status}`);

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
      continue;
    }

    failed += 1;
    diagnostics.push({
      token: maskPushToken(device.expoPushToken),
      stage: "ticket",
      status: "error",
      ...(ticket?.id ? { ticketId: ticket.id } : {}),
      ...(ticket?.details?.error ? { error: ticket.details.error } : {}),
      message: ticket?.message ?? "Expo did not accept this push notification.",
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
        continue;
      }

      if (receipt.status === "ok") {
        receiptDelivered += 1;
        diagnostics.push({ token: maskPushToken(device.expoPushToken), stage: "receipt", status: "ok", ticketId: id });
        continue;
      }

      receiptFailed += 1;
      diagnostics.push({
        token: maskPushToken(device.expoPushToken),
        stage: "receipt",
        status: "error",
        ticketId: id,
        ...(receipt.details?.error ? { error: receipt.details.error } : {}),
        message: receipt.message ?? "APNs/FCM rejected this push notification.",
      });
      if (receipt.details?.error === "DeviceNotRegistered") {
        await removeMobilePushDevice(input.userId, device.expoPushToken);
        removedInvalidTokens += 1;
      }
    }
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
