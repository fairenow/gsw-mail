type JmapFailure = {
  type?: string;
  callId?: string;
  response?: unknown;
  message?: string;
  cause?: JmapFailure;
};

export function describeJmapFailure(error: unknown): JmapFailure | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { message?: unknown; type?: unknown; callId?: unknown; response?: unknown; cause?: unknown };
  const cause = describeJmapFailure(value.cause);
  return {
    ...(typeof value.type === "string" ? { type: value.type } : {}),
    ...(typeof value.callId === "string" ? { callId: value.callId } : {}),
    ...(value.response !== undefined ? { response: value.response } : {}),
    ...(typeof value.message === "string" ? { message: value.message } : {}),
    ...(cause ? { cause } : {}),
  };
}
