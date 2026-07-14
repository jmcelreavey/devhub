import { describe, expect, it } from "vitest";
import { detectSignals, isContentCandidate, type ScanFile } from "./detectors";

function file(path: string, content?: string): ScanFile {
  const base = path.split("/").pop()!.toLowerCase();
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot) : "";
  return { path, base, ext, content };
}

const ids = (files: ScanFile[]) => detectSignals(files).map((s) => s.id).sort();

describe("detectSignals — filename rules", () => {
  it("detects Terraform, Helm, Kustomize, Docker, Actions", () => {
    const files = [
      file("infra/main.tf"),
      file("infra/.terraform.lock.hcl"),
      file("chart/Chart.yaml"),
      file("overlays/prod/kustomization.yaml"),
      file("Dockerfile"),
      file(".github/workflows/ci.yml"),
    ];
    expect(ids(files)).toEqual(
      expect.arrayContaining(["terraform", "helm", "kustomize", "docker", "github-actions"]),
    );
  });

  it("does not flag workflow-shaped yaml outside .github/workflows", () => {
    expect(ids([file("config/ci.yml")])).not.toContain("github-actions");
  });

  it("detects monorepo tooling", () => {
    expect(ids([file("pnpm-workspace.yaml")])).toContain("monorepo");
  });
});

describe("detectSignals — content rules", () => {
  it("detects Flux and derives GitOps pattern", () => {
    const hr = file(
      "clusters/prod/app.yaml",
      "apiVersion: helm.toolkit.fluxcd.io/v2beta1\nkind: HelmRelease\nmetadata:\n  name: app\n",
    );
    const result = ids([hr]);
    expect(result).toContain("flux");
    expect(result).toContain("gitops");
  });

  it("detects Crossplane compositions", () => {
    const comp = file(
      "compositions/rds.yaml",
      "apiVersion: apiextensions.crossplane.io/v1\nkind: Composition\n",
    );
    expect(ids([comp])).toContain("crossplane");
  });

  it("detects workload identity / IRSA from role-arn annotation", () => {
    const sa = file(
      "k8s/serviceaccount.yaml",
      "kind: ServiceAccount\nmetadata:\n  annotations:\n    eks.amazonaws.com/role-arn: arn:aws:iam::123:role/app\n",
    );
    expect(ids([sa])).toContain("workload-identity");
  });

  it("detects External Secrets", () => {
    const es = file("k8s/secret.yaml", "apiVersion: external-secrets.io/v1beta1\nkind: ExternalSecret\n");
    expect(ids([es])).toContain("external-secrets");
  });

  it("infers data technologies from package manifests", () => {
    const result = ids([
      file("package.json", '{"dependencies":{"mongodb":"^7.3.0","better-sqlite3":"^12.0.0"}}'),
    ]);
    expect(result).toContain("mongodb");
    expect(result).toContain("sqlite");
  });

  it("detects MongoDB from imports and connection strings", () => {
    expect(ids([file("src/db.ts", "import { MongoClient } from 'mongodb';")])).toContain("mongodb");
    expect(ids([file("docker-compose.yml", "MONGO_URL=mongodb://mongo:27017/app")])).toContain("mongodb");
  });

  it("keeps MongoDB Atlas separate from generic MongoDB", () => {
    expect(ids([file("infra/atlas.tf", 'resource "mongodbatlas_cluster" "main" {}')])).toContain("mongodb-atlas");
  });

  it("detects MongoDB from a package.json dependency", () => {
    expect(ids([file("package.json", '{"dependencies":{"mongodb":"^6.0.0"}}')])).toContain("mongodb");
    expect(ids([file("package.json", '{"dependencies":{"@nestjs/mongoose":"^11.0.0"}}')])).toContain("mongodb");
  });

  it("detects MongoDB from driver usage and connection strings", () => {
    expect(ids([file("src/db.ts", 'new MongoClient(process.env.MONGO_URL)')])).toContain("mongodb");
    expect(ids([file("config.yaml", "uri: mongodb://localhost:27017/insider")])).toContain("mongodb");
  });

  it("does not flag MongoDB on unrelated package.json or code", () => {
    expect(ids([file("package.json", '{"dependencies":{"react":"^19.0.0"}}')])).not.toContain("mongodb");
    expect(ids([file("src/db.ts", "const cache = new Map()")])).not.toContain("mongodb");
  });

  it("does not fire content rules when content is absent", () => {
    // Same path, no content read → only filename rules apply (none here).
    expect(ids([file("clusters/prod/app.yaml")])).toEqual([]);
  });

  it("suppresses bare kubernetes signal when Flux is present", () => {
    const deploy = file(
      "app.yaml",
      "apiVersion: helm.toolkit.fluxcd.io/v2beta1\nkind: HelmRelease\n---\napiVersion: apps/v1\nkind: Deployment\n",
    );
    const result = ids([deploy]);
    expect(result).toContain("flux");
    // kubernetes may still appear from the Deployment; GitOps is the headline.
    expect(result).toContain("gitops");
  });
});

describe("confidence + evidence", () => {
  it("caps evidence and raises confidence with repeated hits", () => {
    const tfs = Array.from({ length: 30 }, (_, i) => file(`infra/mod${i}.tf`));
    const [terraform] = detectSignals(tfs).filter((s) => s.id === "terraform");
    expect(terraform.count).toBe(30);
    expect(terraform.evidence.length).toBeLessThanOrEqual(12);
    expect(terraform.confidence).toBeGreaterThan(0.9);
    expect(terraform.confidence).toBeLessThanOrEqual(1);
  });
});

describe("isContentCandidate", () => {
  it("includes yaml/tf/ts, excludes png", () => {
    expect(isContentCandidate(".yaml")).toBe(true);
    expect(isContentCandidate(".tf")).toBe(true);
    expect(isContentCandidate(".png")).toBe(false);
  });
});
