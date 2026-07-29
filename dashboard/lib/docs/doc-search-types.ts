/** Search payload shapes. Client-safe. */

export interface DocSearchSection {
  /** Nearest preceding heading, or the doc title for the lead section. */
  heading: string;
  /** Heading anchor id, empty for the lead section. */
  id: string;
  /** Flattened plain text of the section body. */
  text: string;
}

export interface DocSearchMatch {
  heading: string;
  href: string;
  snippet: string;
}

export interface DocSearchHit {
  slug: string;
  title: string;
  href: string;
  section: string;
  description?: string;
  score: number;
  matches: DocSearchMatch[];
}
