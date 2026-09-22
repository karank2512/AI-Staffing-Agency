import type { DeliverableFormatSlug } from "./job-spec";

/** Domain schemas use lowercase slugs; Prisma enums are UPPERCASE. One mapper so modules never diverge. */
export type DbDeliverableFormat = "MARKDOWN" | "CSV" | "JSON";

export function toDbDeliverableFormat(f: DeliverableFormatSlug): DbDeliverableFormat {
  return f.toUpperCase() as DbDeliverableFormat;
}

export function fromDbDeliverableFormat(f: DbDeliverableFormat): DeliverableFormatSlug {
  return f.toLowerCase() as DeliverableFormatSlug;
}
