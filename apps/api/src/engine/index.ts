import { config } from "../config.js";
import { DemoEngine } from "./demo.js";
import { StalwartEngine } from "./stalwart.js";
import type { MailEngine } from "./types.js";

let engine: MailEngine | undefined;

export function getEngine(): MailEngine {
  if (!engine) {
    engine = config.mailEngine === "stalwart" ? new StalwartEngine() : new DemoEngine();
  }
  return engine;
}