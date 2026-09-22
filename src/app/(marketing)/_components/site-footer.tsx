import Link from "next/link";
import { SIGN_IN_PATH, SIGN_UP_PATH } from "@/server/auth";

/**
 * Only destinations that exist are links. "About", "Contact", "Help center", "Status", "Privacy" and "Terms"
 * are not built yet, so they render as plain text rather than as promises that 404.
 */
interface FooterItem {
  label: string;
  href?: string;
}

const COLUMNS: { heading: string; items: FooterItem[] }[] = [
  {
    heading: "Product",
    items: [
      { label: "How it works", href: "#how" },
      { label: "Security", href: "#security" },
      { label: "Pricing", href: "#pricing" },
    ],
  },
  {
    heading: "Account",
    items: [
      { label: "Sign in", href: SIGN_IN_PATH },
      { label: "Create account", href: SIGN_UP_PATH },
    ],
  },
  {
    heading: "Company",
    items: [{ label: "About" }, { label: "Contact" }],
  },
  {
    heading: "Legal",
    items: [{ label: "Privacy" }, { label: "Terms" }],
  },
];

export function SiteFooter({ simulated }: { simulated: boolean }) {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-canvas px-4 py-14 text-muted-foreground shadow-[inset_0_0.5px_0_var(--hairline)] sm:px-6">
      <div className="mx-auto w-full max-w-(--container-marketing)">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4">
          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <h2 className="text-[12px] leading-4 font-semibold text-foreground">{column.heading}</h2>
              <ul className="mt-3 space-y-2.5">
                {column.items.map((item) => (
                  <li key={item.label} className="text-[12px] leading-4">
                    {item.href ? (
                      item.href.startsWith("#") ? (
                        <a href={item.href} className="hover:text-foreground hover:underline">
                          {item.label}
                        </a>
                      ) : (
                        <Link href={item.href} className="hover:text-foreground hover:underline">
                          {item.label}
                        </Link>
                      )
                    ) : (
                      <span>{item.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-[12px] leading-4 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {year} AI Staffing Agency. All rights reserved.</p>
          <p>Made for teams who&rsquo;d rather review than repeat.</p>
        </div>

        {simulated ? (
          <p className="mt-3 text-[12px] leading-4">
            This deployment runs in simulated mode: model calls and tools are stand-ins, priced for reference and
            never billed.
          </p>
        ) : null}
      </div>
    </footer>
  );
}
