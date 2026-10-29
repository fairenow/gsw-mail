import { AsyncLocalStorage } from "node:async_hooks";
type ScopedTool = { name: string; requiredScopes: readonly string[] };
const boundary = new AsyncLocalStorage<(tool: ScopedTool) => boolean>();
export function toolWithinBoundary(tool: ScopedTool): boolean {
  return boundary.getStore()?.(tool) ?? true;
}
export function withToolBoundary<T>(allows: (tool: ScopedTool) => boolean, execute: () => T): T {
  const parent = boundary.getStore();
  return boundary.run(tool => allows(tool) && (parent?.(tool) ?? true), execute);
}
