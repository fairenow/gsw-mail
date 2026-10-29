export async function resolveMailboxCredential(input: {
  stored: () => Promise<string | null>;
  refresh: () => Promise<string | null>;
  interactive: () => Promise<string>;
  report: (stage: string) => void;
}): Promise<string> {
  for (const stage of ["stored", "refresh"] as const) {
    try {
      const token = await input[stage]();
      if (token) {
        input.report(stage);
        return token;
      }
    } catch {
      input.report(`${stage}_unavailable`);
    }
  }
  input.report("interactive");
  return input.interactive();
}
