import type { Sector } from "../constraints";
import { companyEntities, entitiesFrom, fixturesFrom, type CompanyEntity, type CompanyFixture, type Row } from "./companies";

/**
 * 36 CLEARLY FICTIONAL fintech companies (names, funds and people are invented; every URL uses `.example`) for
 * briefs that target fintech — the headline "Series A fintech lead list" and "fintech companies in Europe" jobs.
 * Deliberately shaped like a real prospect universe: mostly Series A with a European majority, plus seed and
 * Series B rounds and US/other HQs, so stage and region constraints have something to filter.
 */

const BY_CATEGORY: Record<string, Row[]> = {
  "Payments Infrastructure": [
    ["Ledgerlight", "ledgerlight", "Series A", 24, 3, "Northwind Crest Partners", "London, UK", 58, "Account-to-account payment rails for European marketplaces, with instant settlement and built-in reconciliation."],
    ["Kitepay", "kitepay", "Series A", 15, 10, "Brightwater Partners", "Lisbon, Portugal", 41, "Payment orchestration that routes each transaction to the cheapest acquirer across Southern Europe."],
    ["Railbird", "railbird", "Series A", 28, 5, "Foundry Lane Capital", "New York, NY", 61, "Real-time payments APIs for US platforms moving money over instant-payment networks."],
    ["Pennywhistle", "pennywhistle", "Seed", 4.5, 9, "Quorum Seed Fund", "Berlin, Germany", 14, "Open-banking payment links for freelancers and small agencies."],
    ["Northgate Payments", "northgatepayments", "Series B", 64, 14, "Lantern Growth", "London, UK", 190, "Merchant acquiring for European enterprise retailers, with unified online and in-store payments."],
  ],
  "Embedded Finance": [
    ["Paywick", "paywick", "Series A", 19, 6, "Harborlight Ventures", "Berlin, Germany", 47, "Embedded payments and payouts API that lets vertical SaaS platforms offer card acceptance in a week."],
    ["Invoicery", "invoicery", "Series A", 20, 24, "Foundry Lane Capital", "Copenhagen, Denmark", 48, "Invoice financing embedded in accounting software for small businesses across the Nordics."],
    ["Copperleaf", "copperleaf", "Series A", 17, 26, "Evergreen Row Ventures", "San Francisco, CA", 40, "Embedded corporate cards and spend controls for vertical software platforms."],
  ],
  "Treasury & FX": [
    ["Tallyforge", "tallyforge", "Series A", 22, 4, "Meridian Peak Ventures", "Paris, France", 51, "Treasury and FX automation for mid-market companies holding cash in several currencies."],
    ["Settleport", "settleport", "Series A", 18.5, 16, "Signal Ridge Capital", "Frankfurt, Germany", 45, "Cross-border B2B payouts over local rails in 40 countries, with same-day settlement."],
  ],
  Lending: [
    ["Lendwell", "lendwell", "Series A", 27, 15, "Blue Heron Partners", "Stockholm, Sweden", 64, "Revenue-based financing for European SaaS companies, underwritten from live billing data."],
    ["Stackwise", "stackwise", "Series A", 29, 2, "Tidewater Ventures", "Milan, Italy", 66, "Buy-now-pay-later infrastructure for B2B wholesale orders in Southern Europe."],
    ["Covenant Cloud", "covenantcloud", "Series A", 25, 11, "Atlas North Capital", "Chicago, IL", 58, "Loan origination and servicing software for community banks and credit unions."],
    ["Fairshare Lending", "fairsharelending", "Seed", 6, 12, "Ninth Street Ventures", "New York, NY", 18, "Credit-builder loans for renters, underwritten from rent payment history."],
    ["Fundbridge", "fundbridge", "Series B", 55, 25, "Meridian Peak Ventures", "Berlin, Germany", 160, "SME lending marketplace connecting small businesses with 60 European lenders."],
  ],
  "Banking-as-a-Service": [
    ["Fernbank", "fernbank", "Series A", 31, 12, "Tidewater Ventures", "Dublin, Ireland", 72, "EU-licensed banking-as-a-service platform with IBAN accounts, cards and ledgers behind one API."],
    ["Mintlane", "mintlane", "Series A", 26, 13, "Atlas North Capital", "Tallinn, Estonia", 62, "Card issuing and virtual accounts for fintechs expanding into the Baltics and the Nordics."],
    ["Ballast Finance", "ballastfinance", "Series A", 33, 20, "Lantern Growth", "Toronto, Canada", 70, "Banking-as-a-service for Canadian fintechs: accounts, cards and payments from one sponsor bank."],
    ["Quillbank", "quillbank", "Seed", 5.2, 31, "Quorum Seed Fund", "Amsterdam, Netherlands", 16, "Multi-entity business banking for startups with subsidiaries across the EU."],
  ],
  WealthTech: [
    ["Vaultrise", "vaultrise", "Series A", 17, 21, "Harborlight Ventures", "Zurich, Switzerland", 36, "White-label investing and savings products for European banks and neobanks."],
    ["Ondine", "ondine", "Series A", 13, 28, "Brightwater Partners", "Vienna, Austria", 33, "Pension and savings dashboards for employers, with automated contributions across providers."],
    ["Tillwise", "tillwise", "Series A", 15.5, 30, "Copperline Capital", "Boston, MA", 38, "Portfolio management and client reporting software for independent financial advisors."],
    ["Oakvale Wealth", "oakvalewealth", "Series B", 42, 41, "Foundry Lane Capital", "Stockholm, Sweden", 120, "Digital private banking for affluent investors across the Nordics."],
  ],
  "RegTech & Compliance": [
    ["Clearmint", "clearmint", "Series A", 16, 9, "Copperline Capital", "Amsterdam, Netherlands", 39, "Automated KYB and transaction monitoring for fintechs launching in new EU markets."],
    ["Auditrail", "auditrail", "Series A", 14, 27, "Northwind Crest Partners", "Warsaw, Poland", 57, "Continuous audit trails and regulatory reporting for EU payment institutions."],
    ["Taxloom", "taxloom", "Series A", 19, 14, "Blue Heron Partners", "Austin, TX", 46, "Sales-tax and 1099 compliance automation built into payment flows."],
    ["Ledgerlark", "ledgerlark", "Seed", 3.8, 23, "Paper Crane Capital", "London, UK", 11, "Model-assisted review of financial promotions for UK-regulated firms."],
    ["Compliable", "compliable", "Series B", 48, 33, "Atlas North Capital", "New York, NY", 140, "Enterprise AML case management and regulatory reporting for banks and brokerages."],
  ],
  "Fraud Prevention": [
    ["Guardline", "guardline", "Series A", 18, 7, "Signal Ridge Capital", "Madrid, Spain", 44, "Real-time fraud scoring for card-not-present payments from device and behavioural signals."],
    ["Riskwell", "riskwell", "Series A", 23, 19, "Copperline Capital", "London, UK", 55, "Push-payment scam detection for UK banks, trained on consortium data."],
    ["Tripwire Risk", "tripwirerisk", "Series A", 22, 8, "Signal Ridge Capital", "Tel Aviv, Israel", 52, "Chargeback prevention and dispute automation for high-volume merchants."],
    ["Graniteguard", "graniteguard", "Series B", 51, 29, "Lantern Growth", "San Francisco, CA", 150, "Identity verification and account-takeover protection for US neobanks."],
  ],
  InsurTech: [
    ["Coverwise", "coverwise", "Series A", 21, 18, "Evergreen Row Ventures", "Munich, Germany", 53, "Embedded insurance APIs that let e-commerce and mobility platforms sell cover at checkout."],
    ["Claimspark", "claimspark", "Series A", 16.5, 22, "Meridian Peak Ventures", "Barcelona, Spain", 42, "Claims automation for European insurers: photo-based damage assessment and instant payouts."],
    ["Suretrack", "suretrack", "Series A", 20.5, 17, "Harborlight Ventures", "Singapore", 49, "Usage-based insurance for gig-economy workers across Southeast Asia."],
    ["Tidemark Insure", "tidemarkinsure", "Seed", 4.1, 38, "Paper Crane Capital", "Paris, France", 12, "Parametric weather insurance for European farmers, paid out automatically."],
  ],
};

export const FINTECH_FIXTURES: readonly CompanyFixture[] = fixturesFrom(BY_CATEGORY);

/** Most recent round first. */
export function fintechEntities(now: Date): CompanyEntity[] {
  return entitiesFrom(FINTECH_FIXTURES, now);
}

/** The company universe a brief (or a search query) is about. AI infrastructure unless it targets fintech. */
export function sectorEntities(sector: Sector | null | undefined, now: Date): CompanyEntity[] {
  return sector === "fintech" ? fintechEntities(now) : companyEntities(now);
}

/** Every simulated company, for resolving pages, mentions and records whatever the universe. */
export function allCompanyEntities(now: Date): CompanyEntity[] {
  return [...companyEntities(now), ...fintechEntities(now)];
}
