import { next, rewrite } from "@vercel/functions";

export const config = { matcher: "/" };

export default function middleware(request: Request) {
  const url = new URL(request.url);
  if (url.hostname !== "mail-docs.guidedstepswellness.com") return next();
  url.pathname = "/docs/index.html";
  return rewrite(url);
}
