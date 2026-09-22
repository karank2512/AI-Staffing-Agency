import { handlers } from "@/server/auth";

// Auth.js endpoints (session, csrf, credentials callback, signout). Needs Prisma + bcrypt → Node runtime.
export const runtime = "nodejs";

export const { GET, POST } = handlers;
