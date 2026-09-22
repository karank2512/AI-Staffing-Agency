import { Prisma, PrismaClient } from "@prisma/client";

// Single PrismaClient per process. The globalThis cache survives Next.js dev HMR reloads.
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

export const db: PrismaClient =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "query" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.__prisma = db;

export type Db = PrismaClient;
/** Transaction client type for helpers that accept either the root client or a tx. */
export type DbTx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export type DbOrTx = Db | DbTx;

/**
 * Convert any JSON-serializable domain object (JobSpec, WorkerBlueprint, RunCheckpoint …) into a value Prisma
 * accepts for a Json column. Round-trips through JSON, so `undefined` is dropped and Dates become ISO strings.
 */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
