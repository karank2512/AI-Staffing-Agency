import { AVATAR_COLORS, JOB_FAMILY_INFO, type AvatarColor, type JobFamily, type Persona } from "@/server/domain";
import { hashSeed } from "@/server/simulation";

/**
 * Worker personas. Names come from a fixed pool so a workforce reads like a team ("Alex", "Maya", "Sam"…), the
 * pick is a pure function of the job (same job → same name) and never collides with a name already in use.
 */

export const PERSONA_NAMES: readonly string[] = [
  "Alex", "Maya", "Sam", "Priya", "Jordan", "Elena", "Kai", "Amara",
  "Leo", "Sofia", "Noah", "Yuki", "Omar", "Zara", "Mateo", "Ines",
  "Ravi", "Chloe", "Tomas", "Aisha", "Felix", "Nadia", "Idris", "Lena",
];

const norm = (s: string) => s.trim().toLowerCase();

/** Deterministic pick from the pool, skipping names already in use (case-insensitive); numbered when all are taken. */
export function pickPersonaName(seedText: string, usedNames: readonly string[] = []): string {
  const used = new Set(usedNames.map(norm));
  const start = hashSeed(seedText) % PERSONA_NAMES.length;
  for (let i = 0; i < PERSONA_NAMES.length; i++) {
    const candidate = PERSONA_NAMES[(start + i) % PERSONA_NAMES.length];
    if (!used.has(norm(candidate))) return candidate;
  }
  // Every name is taken: "Alex 2", "Alex 3", … keeps the team readable instead of failing the hire.
  const base = PERSONA_NAMES[start];
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} ${n}`;
    if (!used.has(norm(candidate))) return candidate;
  }
  return `${base} ${hashSeed(`${seedText}|overflow`)}`;
}

/** Keep a proposed name only when it is a plausible first name and not already in use. */
export function resolvePersonaName(proposed: string | undefined, seedText: string, usedNames: readonly string[] = []): string {
  const clean = (proposed ?? "").replace(/\s+/g, " ").trim();
  const plausible = clean.length >= 2 && clean.length <= 40 && /^[\p{L}][\p{L}' -]*$/u.test(clean);
  if (!plausible) return pickPersonaName(seedText, usedNames);
  const used = new Set(usedNames.map(norm));
  return used.has(norm(clean)) ? pickPersonaName(seedText, usedNames) : clean;
}

export function avatarColorFor(name: string): AvatarColor {
  return AVATAR_COLORS[hashSeed(norm(name)) % AVATAR_COLORS.length];
}

export function personaTitleFor(family: JobFamily, proposed?: string): string {
  const clean = (proposed ?? "").replace(/\s+/g, " ").trim();
  return clean.length >= 3 && clean.length <= 80 ? clean : JOB_FAMILY_INFO[family].workerTitle;
}

export function defaultPersonaSummary(name: string, family: JobFamily, deliverableTitle: string): string {
  const info = JOB_FAMILY_INFO[family];
  const does = `${info.description.charAt(0).toLowerCase()}${info.description.slice(1).replace(/\.$/, "")}`;
  return `${name} is an ${info.workerTitle} who ${does}. Every run ends with a "${deliverableTitle}" you can review, accept or send back.`;
}

export function buildPersona(args: {
  family: JobFamily;
  seedText: string;
  proposed: { name?: string; title?: string; summary?: string };
  usedNames?: readonly string[];
  deliverableTitle: string;
}): Persona {
  const name = resolvePersonaName(args.proposed.name, args.seedText, args.usedNames);
  const summary = (args.proposed.summary ?? "").trim();
  return {
    name,
    title: personaTitleFor(args.family, args.proposed.title),
    summary: summary.length >= 20 ? summary : defaultPersonaSummary(name, args.family, args.deliverableTitle),
    avatarColor: avatarColorFor(name),
  };
}
