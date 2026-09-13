import { provisionUserFromIdentity } from "../auth/provision.js";

const subjects = (process.env.STALWART_BACKFILL_USERS ?? "")
  .split(",")
  .map((subject) => subject.trim())
  .filter(Boolean);

if (subjects.length === 0) {
  throw new Error("STALWART_BACKFILL_USERS must contain comma-separated Stalwart usernames");
}

for (const subject of subjects) {
  const user = await provisionUserFromIdentity("stalwart", subject);
  console.log("provisioned:", subject, "->", user.id);
}
