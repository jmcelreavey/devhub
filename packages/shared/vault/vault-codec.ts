export interface VaultCodec {
  extension: string;
  parse(raw: string): unknown;
  serialize(content: unknown): string;
}

const EMPTY_NOTE: unknown[] = [
  {
    id: crypto.randomUUID(),
    type: "paragraph",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
    content: [{ type: "text", text: "", styles: {} }],
    children: [],
  },
];

export const jsonVaultCodec: VaultCodec = {
  extension: ".json",
  parse(raw: string) {
    return JSON.parse(raw) as unknown;
  },
  serialize(content: unknown) {
    if (typeof content === "string") {
      try {
        JSON.parse(content);
        return content;
      } catch {
        const wrapped = JSON.parse(JSON.stringify(EMPTY_NOTE)) as Array<Record<string, unknown>>;
        return JSON.stringify(
          wrapped.map((b) => ({
            ...b,
            content: [{ type: "text", text: content, styles: {} }],
          })),
          null,
          2,
        );
      }
    }
    return JSON.stringify(content, null, 2);
  },
};

export const markdownVaultCodec: VaultCodec = {
  extension: ".md",
  parse(raw: string) {
    return raw;
  },
  serialize(content: unknown) {
    if (typeof content === "string") {
      return content;
    }
    throw new Error("Markdown vault content must be a string");
  },
};
