declare module "adm-zip" {
  export default class AdmZip {
    constructor();
    addFile(path: string, data: Buffer): void;
    toBuffer(): Buffer;
  }
}
