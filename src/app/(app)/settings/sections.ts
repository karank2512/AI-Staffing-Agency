/**
 * The sections of the account area, and the `?section=` parsing both the page and its navigation share.
 * Pure — no server imports — so the rail, the mobile index and the page all read from one list.
 */

export const SETTINGS_SECTIONS = [
  { id: "workspace", label: "Workspace", blurb: "Name, monthly budget and spend" },
  { id: "members", label: "Members", blurb: "Who can hire, review and spend" },
  { id: "security", label: "Security", blurb: "Password, sessions and recent activity" },
  { id: "providers", label: "AI providers", blurb: "Which models your workers think with" },
  { id: "credentials", label: "Tool credentials", blurb: "Keys your workers' tools use" },
  { id: "runtime", label: "Runtime", blurb: "The background worker and demo data" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "workspace";

const IDS = new Set<string>(SETTINGS_SECTIONS.map((s) => s.id));

/**
 * Tolerant parse of `?section=`. `null` means "no section chosen": desktop falls back to the first one,
 * while mobile shows the index list instead (the drill-in pattern from docs/DESIGN.md).
 */
export function parseSettingsSection(raw: string | string[] | undefined): SettingsSectionId | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value !== undefined && IDS.has(value) ? (value as SettingsSectionId) : null;
}

export function settingsHref(id: SettingsSectionId): string {
  return `/settings?section=${id}`;
}

export function settingsSection(id: SettingsSectionId): (typeof SETTINGS_SECTIONS)[number] {
  return SETTINGS_SECTIONS.find((s) => s.id === id) ?? SETTINGS_SECTIONS[0];
}
