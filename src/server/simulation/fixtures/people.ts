import { hashSeed, seededPick } from "../rng";
import type { CategoryGroup } from "./companies";

/**
 * Deterministic, invented people for the fictional companies: quoted executives in news articles and the
 * contacts that lead-research workers "find". Names are generated from pools keyed by the company slug, so
 * the same company always has the same leadership; every address uses the reserved `.example` TLD.
 */

export interface SimPerson {
  name: string;
  title: string;
  email: string;
  linkedin_url: string;
}

const FIRST_NAMES = [
  "Maya", "Arjun", "Lena", "Tomas", "Priya", "Jonas", "Amara", "Kenji", "Sofia", "Idris",
  "Noor", "Mateo", "Hana", "Elias", "Zara", "Callum", "Mei", "Oskar", "Leila", "Dario",
  "Ingrid", "Tobias", "Anika", "Rafael", "Yuki", "Nadia", "Felix", "Sana", "Marcus", "Elena",
] as const;

const LAST_NAMES = [
  "Okafor", "Lindqvist", "Castellanos", "Varga", "Iyer", "Brandt", "Moreau", "Tanaka", "Haddad", "Novak",
  "Whitfield", "Serrano", "Kowalski", "Adeyemi", "Rasmussen", "Banerjee", "Delacroix", "Petrov", "Nakamura", "Ferreira",
  "Holloway", "Abara", "Stavros", "Lindgren", "Qureshi", "Marchetti", "Oyelaran", "Sandoval", "Vance", "Eriksen",
] as const;

/** The buyer a sales team would most plausibly approach, by what the company sells. */
const BUYER_TITLES: Record<CategoryGroup, readonly string[]> = {
  compute: ["VP of Infrastructure", "Head of Platform Engineering", "Director of Data Center Operations"],
  serving: ["VP of Engineering", "Head of Platform", "Director of ML Engineering"],
  data: ["VP of Data", "Head of Data Engineering", "Director of ML Operations"],
  trust_agents: ["Head of Engineering", "VP of Product", "Director of AI Platform"],
  payments: ["VP of Engineering", "Head of Payments Engineering", "Director of Platform Engineering"],
  lending_banking: ["CTO", "Head of Engineering", "VP of Platform"],
  risk_compliance: ["Head of Risk Engineering", "VP of Engineering", "Director of Data Science"],
};

function person(seedKey: string, title: string, emailDomain: string): SimPerson {
  const first = seededPick(FIRST_NAMES, hashSeed(`${seedKey}|first`));
  const last = seededPick(LAST_NAMES, hashSeed(`${seedKey}|last`));
  const handle = `${first}.${last}`.toLowerCase();
  return {
    name: `${first} ${last}`,
    title,
    email: `${handle}@${emailDomain}`,
    linkedin_url: `https://linkedin.example/in/${handle.replace(".", "-")}`,
  };
}

export function companyPeople(slug: string, group: CategoryGroup): { ceo: SimPerson; buyer: SimPerson; cto: SimPerson } {
  const domain = `${slug}.example`;
  return {
    ceo: person(`${slug}|ceo`, "Co-founder & CEO", domain),
    cto: person(`${slug}|cto`, "Co-founder & CTO", domain),
    buyer: person(`${slug}|buyer`, seededPick(BUYER_TITLES[group], hashSeed(`${slug}|buyer-title`)), domain),
  };
}

/** The (fictional) partner quoted for a (fictional) fund. */
export function investorPartner(investor: string): string {
  const p = person(`investor|${investor}`, "Partner", "funds.example");
  return p.name;
}
