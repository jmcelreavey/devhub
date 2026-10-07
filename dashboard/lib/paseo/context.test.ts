import { describe, expect, it, vi } from "vitest";
vi.mock("./managed", () => ({ readPaseoManaged: () => null }));
vi.mock("./client", () => ({ withPaseo: vi.fn() }));
import { mergePaseoContext } from "./context";
describe("Paseo shared context", () => {
  it("keeps the user's host prompt and replaces only DevHub's block", () => {
    const first = mergePaseoContext("My extra instructions", "Persona one");
    const next = mergePaseoContext(first + "\nMore personal instructions", "Persona two");
    expect(next).toContain("My extra instructions");
    expect(next).toContain("More personal instructions");
    expect(next).toContain("Persona two");
    expect(next).not.toContain("Persona one");
    expect(mergePaseoContext(next, "Persona two")).toBe(next);
  });
});
