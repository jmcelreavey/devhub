/** POSIX single-quote a value so a shell passes it through as one literal argument. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
