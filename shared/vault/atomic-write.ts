import fs from "node:fs";
import path from "node:path";

/** Atomic sync write — shared by dashboard vault storage and MCP. */
export function writeAtomicNow(filePath: string, data: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  try {
    fs.writeFileSync(tmp, data, "utf-8");
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // tmp may not exist
    }
    throw err;
  }
}
