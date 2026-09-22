import type { Simulation } from "@/server/simulation/types";
import { agentTurn } from "./brain";
import { dataset } from "./datasets";
import { systemClock, type Clock } from "./dates";
import { extractRecords } from "./extract";
import { companyEntities, toSimCompany } from "./fixtures/companies";
import { feedbackItems } from "./fixtures/feedback";
import { fetchPage } from "./pages";
import { search } from "./search";

/**
 * Simulated mode — the fixture "web", sample datasets and the mock agent brain (contract: simulation/types.ts).
 *
 * Every function is a pure function of its arguments plus ONE impure input: the clock, read once per call so
 * fixture dates ("announced 3 days ago") always look fresh. `createSimulation` lets tests pin that clock.
 */
export function createSimulation(clock: Clock): Simulation {
  return {
    search: (query, opts) => search(query, opts, clock()),
    fetchPage: (url) => fetchPage(url, clock()),
    extractRecords: (text, fields, opts) => extractRecords(text, fields, opts, clock()),
    companies: () => companyEntities(clock()).map(toSimCompany),
    feedback: () => feedbackItems(clock()),
    dataset: (name) => dataset(name, clock()),
    agentTurn: (input) => agentTurn(input, clock()),
  };
}

export const simulation: Simulation = createSimulation(systemClock);

export { hashSeed, seededPick, seededShuffle } from "./rng";
export type * from "./types";
