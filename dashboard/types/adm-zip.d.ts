declare module "adm-zip" {
  export interface IZipEntry {
    /** Path of the entry inside the archive, e.g. "skills/foo/SKILL.md". */
    entryName: string;
    isDirectory: boolean;
    getData(): Buffer;
  }

  export default class AdmZip {
    /** Omit the path to start an empty archive; pass one to read an existing zip. */
    constructor(input?: string | Buffer);
    addFile(path: string, data: Buffer): void;
    /**
     * Recursively add a directory. `filter` receives each candidate's local path and
     * returns whether to include it.
     */
    addLocalFolder(
      localPath: string,
      zipPath?: string,
      filter?: RegExp | ((filename: string) => boolean),
    ): void;
    getEntries(): IZipEntry[];
    getEntry(name: string): IZipEntry | null;
    writeZip(targetFileName?: string): void;
    toBuffer(): Buffer;
  }
}
