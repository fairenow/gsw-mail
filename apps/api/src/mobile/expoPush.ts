import { listMobilePushDevices, removeMobilePushDevice } from "./pushDevices.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type PushData = Record<string, string | number | boolean | null>;

type ExpoTicket = {
  status?: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

export type PushDeliveryResult = {
  attempted: number;
  accepted: number;
  failed: number;
  removedInvalidTokens: number;
};

export async function sendPushToUser(input: {
  userId: string;
  title: string;
  body: string;
  data?: PushData;
  badge?: number;
  sound?: "default" | null;
  channelId?: string;
}): Promise<PushDeliveryResult> {
  const devices = await listMobilePushDevices(input.userId);
  if (!devices.length) return { attempted: 0, accepted: 0, failed: 0, removedInvalidTokens: 0 };

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

  const payload = await response.json() as { data?: ExpoTicket[] };
  const tickets = payload.data ?? [];
  let accepted = 0;
  let failed = 0;
  let removedInvalidTokens = 0;

  for (let index = 0; index < devices.length; index += 1) {
    const ticket = tickets[index];
    if (ticket?.status === "ok") {
      accepted += 1;
      continue;
    }
    failed += 1;
    if (ticket?.details?.error === "DeviceNotRegistered") {
      await removeMobilePushDevice(input.userId, devices[index]!.expoPushToken);
      removedInvalidTokens += 1;
    }
  }

  return { attempted: devices.length, accepted, failed, removedInvalidTokens };
}
