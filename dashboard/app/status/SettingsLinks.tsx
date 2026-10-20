import { settingsLinks } from "@/lib/nav";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import styles from "./status.module.css";

/**
 * Agent skills and the QA lab live under Settings but have no top-bar tab: the
 * System strip is already as wide as the bar allows, so they sit under the title.
 */
export function SettingsLinks() {
  return (
    <nav aria-label="More in Settings" className={styles.related}>
      {settingsLinks().map((link) => (
        <Link key={link.href} href={link.href}>
          {link.label}
          <ArrowRight size={12} aria-hidden />
        </Link>
      ))}
    </nav>
  );
}
