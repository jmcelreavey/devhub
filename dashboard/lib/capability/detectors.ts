/**
 * Capability Radar — detection engine.
 *
 * Runs over a list of repo files (path + a bounded set of text contents) and
 * emits {@link DetectedSignal}s. Two kinds of rules:
 *
 *  - **filename rules** — match by extension / basename / path regex. Cheap,
 *    high confidence. Work on both local repos and remote git trees.
 *  - **content rules** — match a regex inside candidate text files (K8s `kind:`,
 *    Terraform providers, annotations…). Higher value for *concepts*
 *    ("workload identity", "external secrets") that no single filename reveals.
 *
 * The engine is pure: callers supply files + optional contents. This lets the
 * local scanner (filesystem) and the GitHub prober (API) share identical logic.
 */

import type { DetectedSignal, SignalArea, SignalKind } from "./types";

export interface ScanFile {
  /** Repo-relative path, forward-slashed. */
  path: string;
  /** Lowercase extension incl. dot, or "" for none. */
  ext: string;
  /** Lowercase basename. */
  base: string;
  /** File text, when available (bounded set only). Undefined = not read. */
  content?: string;
}

interface FilenameRule {
  id: string;
  label: string;
  kind: SignalKind;
  area: SignalArea;
  /** Confidence when matched (default 0.9). */
  confidence?: number;
  match: (f: ScanFile) => boolean;
}

interface ContentRule {
  id: string;
  label: string;
  kind: SignalKind;
  area: SignalArea;
  confidence?: number;
  /** Only test files where this returns true (keeps content scanning bounded). */
  candidate: (f: ScanFile) => boolean;
  re: RegExp;
}

interface PackageRule {
  id: string;
  label: string;
  kind: SignalKind;
  area: SignalArea;
  packages: string[];
  confidence?: number;
}

const MAX_EVIDENCE = 12;

const hasExt = (f: ScanFile, ...exts: string[]) => exts.includes(f.ext);
const isYaml = (f: ScanFile) => f.ext === ".yaml" || f.ext === ".yml";
const isWorkflow = (f: ScanFile) => f.path.startsWith(".github/workflows/") && isYaml(f);

export const FILENAME_RULES: FilenameRule[] = [
  // runtime
  { id: "nextjs", label: "Next.js", kind: "technology", area: "runtime", match: (f) => /^next\.config\.(ts|js|mjs)$/.test(f.base) },
  { id: "typescript", label: "TypeScript", kind: "technology", area: "runtime", confidence: 0.7, match: (f) => f.base === "tsconfig.json" },
  { id: "go", label: "Go", kind: "technology", area: "runtime", match: (f) => f.base === "go.mod" },
  { id: "python", label: "Python", kind: "technology", area: "runtime", match: (f) => f.base === "pyproject.toml" || f.base === "requirements.txt" },
  { id: "rust", label: "Rust", kind: "technology", area: "runtime", match: (f) => f.base === "cargo.toml" },
  { id: "node", label: "Node.js", kind: "technology", area: "runtime", confidence: 0.6, match: (f) => f.base === "package.json" },

  // deploy / packaging
  { id: "docker", label: "Docker", kind: "technology", area: "deploy", match: (f) => f.base === "dockerfile" || /^(docker-)?compose\.ya?ml$/.test(f.base) },
  { id: "helm", label: "Helm", kind: "technology", area: "deploy", match: (f) => f.base === "chart.yaml" },
  { id: "kustomize", label: "Kustomize", kind: "technology", area: "deploy", match: (f) => f.base === "kustomization.yaml" || f.base === "kustomization.yml" },

  // infra as code
  { id: "terraform", label: "Terraform", kind: "technology", area: "infra", match: (f) => hasExt(f, ".tf", ".tfvars") || f.base === ".terraform.lock.hcl" },

  // ci
  { id: "github-actions", label: "GitHub Actions", kind: "technology", area: "ci", match: isWorkflow },
  { id: "gitlab-ci", label: "GitLab CI", kind: "technology", area: "ci", match: (f) => f.base === ".gitlab-ci.yml" },
  { id: "jenkins", label: "Jenkins", kind: "technology", area: "ci", match: (f) => f.base === "jenkinsfile" },

  // architecture / patterns
  { id: "monorepo", label: "Monorepo", kind: "pattern", area: "arch", confidence: 0.8, match: (f) => ["pnpm-workspace.yaml", "turbo.json", "lerna.json", "nx.json"].includes(f.base) },
];

const PACKAGE_RULES: PackageRule[] = [
  { id: "mongodb", label: "MongoDB", kind: "technology", area: "data", packages: ["mongodb", "mongoose", "@nestjs/mongoose"] },
  { id: "postgres", label: "PostgreSQL", kind: "technology", area: "data", packages: ["pg", "postgres", "postgres.js"] },
  { id: "sqlite", label: "SQLite", kind: "technology", area: "data", packages: ["sqlite", "sqlite3", "better-sqlite3", "@libsql/client"] },
  { id: "redis", label: "Redis", kind: "technology", area: "data", packages: ["redis", "ioredis"] },
  { id: "kafka", label: "Kafka", kind: "technology", area: "data", packages: ["kafkajs", "node-rdkafka"] },
];

export const CONTENT_RULES: ContentRule[] = [
  // GitOps controllers (Flux / Argo) — keyed by CRD kind + apiGroup
  { id: "flux", label: "Flux (GitOps)", kind: "technology", area: "deploy", candidate: isYaml, re: /kind:\s*(HelmRelease|Kustomization|GitRepository|OCIRepository|HelmRepository)\b[\s\S]*fluxcd\.io|fluxcd\.io[\s\S]*kind:\s*(HelmRelease|Kustomization|GitRepository|OCIRepository)/ },
  { id: "flux", label: "Flux (GitOps)", kind: "technology", area: "deploy", candidate: isYaml, re: /toolkit\.fluxcd\.io|helm\.toolkit\.fluxcd\.io|source\.toolkit\.fluxcd\.io/ },
  { id: "argocd", label: "Argo CD (GitOps)", kind: "technology", area: "deploy", candidate: isYaml, re: /argoproj\.io\/v1alpha1[\s\S]*kind:\s*(Application|ApplicationSet)|kind:\s*(Application|ApplicationSet)[\s\S]*argoproj\.io/ },

  // Crossplane
  { id: "crossplane", label: "Crossplane", kind: "technology", area: "infra", candidate: isYaml, re: /crossplane\.io|kind:\s*(Composition|CompositeResourceDefinition|Provider)\b/ },

  // Kubernetes core (only if not already GitOps-specific) — broad, lower confidence
  { id: "kubernetes", label: "Kubernetes", kind: "technology", area: "deploy", confidence: 0.6, candidate: isYaml, re: /^\s*apiVersion:\s*(apps\/v1|v1|batch\/v1|networking\.k8s\.io)[\s\S]*^\s*kind:\s*(Deployment|StatefulSet|DaemonSet|Service|Ingress|CronJob|Job)\b/m },

  // Observability
  { id: "opentelemetry", label: "OpenTelemetry", kind: "technology", area: "observability", candidate: (f) => isYaml(f) || hasExt(f, ".toml", ".json", ".ts", ".go", ".py"), re: /opentelemetry|otel[-_]?(collector|exporter|sdk)|otelcol/i },
  { id: "prometheus", label: "Prometheus", kind: "technology", area: "observability", candidate: isYaml, re: /kind:\s*(ServiceMonitor|PrometheusRule|PodMonitor)\b|monitoring\.coreos\.com/ },
  { id: "datadog", label: "Datadog", kind: "technology", area: "observability", confidence: 0.7, candidate: (f) => isYaml(f) || hasExt(f, ".tf", ".toml", ".json"), re: /datadog(hq|-agent|\.yaml)?|dd[-_]?(agent|api[-_]?key)|DD_API_KEY/i },

  // Data
  { id: "mongodb-atlas", label: "MongoDB Atlas", kind: "technology", area: "data", candidate: (f) => hasExt(f, ".tf") || isYaml(f), re: /mongodbatlas|mongodb\+srv|atlas_cluster/i },
  // MongoDB proper (driver/ODM usage) — two rules, one id: a high-confidence
  // package.json dependency check plus a code/config usage check, so apps that
  // talk to Mongo directly (not via Atlas Terraform) are detected too.
  { id: "mongodb", label: "MongoDB", kind: "technology", area: "data", confidence: 0.85, candidate: (f) => f.base === "package.json", re: /"(mongodb|mongoose|@nestjs\/mongoose|connect-mongo|mongodb-memory-server)"\s*:/ },
  { id: "mongodb", label: "MongoDB", kind: "technology", area: "data", confidence: 0.7, candidate: (f) => isYaml(f) || hasExt(f, ".ts", ".js", ".py", ".go", ".toml"), re: /mongodb(\+srv)?:\/\/|MongoClient\b|mongoose\.(connect|model)|image:\s*mongo\b|pymongo/i },
  { id: "mongodb", label: "MongoDB", kind: "technology", area: "data", confidence: 0.7, candidate: (f) => hasExt(f, ".ts", ".js") || isYaml(f), re: /from ['"]mongodb['"]|MongoClient|mongodb:\/\/|mongodb\+srv:\/\//i },
  { id: "postgres", label: "PostgreSQL", kind: "technology", area: "data", confidence: 0.6, candidate: (f) => isYaml(f) || hasExt(f, ".tf", ".toml"), re: /postgres(ql)?:\/\/|image:\s*postgres|aws_db_instance[\s\S]*postgres/i },
  { id: "kafka", label: "Kafka", kind: "technology", area: "data", confidence: 0.7, candidate: (f) => isYaml(f) || hasExt(f, ".tf", ".toml"), re: /\bkafka\b|kind:\s*KafkaTopic|strimzi\.io/i },

  // Concepts (pattern-level — the high-value signals)
  { id: "workload-identity", label: "Workload identity / IRSA", kind: "concept", area: "infra", candidate: (f) => isYaml(f) || hasExt(f, ".tf"), re: /eks\.amazonaws\.com\/role-arn|assume_role_with_web_identity|:oidc-provider\/|iam_openid_connect_provider|azure\.workload\.identity/i },
  { id: "external-secrets", label: "External Secrets", kind: "concept", area: "infra", candidate: isYaml, re: /kind:\s*(ExternalSecret|SecretStore|ClusterSecretStore)\b|external-secrets\.io/ },
  { id: "gitops", label: "GitOps", kind: "pattern", area: "deploy", candidate: isYaml, re: /fluxcd\.io|argoproj\.io/ },
  { id: "feature-flags", label: "Feature flags", kind: "concept", area: "arch", candidate: (f) => hasExt(f, ".ts", ".tsx", ".js", ".go", ".py", ".json", ".yaml", ".yml"), re: /launchdarkly|unleash|flagsmith|ld-relay|featureFlag/i },
  { id: "event-driven", label: "Event-driven / messaging", kind: "concept", area: "arch", confidence: 0.6, candidate: (f) => isYaml(f) || hasExt(f, ".tf", ".ts", ".go"), re: /eventbridge|aws_sns_topic|aws_sqs_queue|domain[-_ ]?event|kind:\s*KafkaTopic|@EventPattern|snssqs/i },
];

interface Acc {
  label: string;
  kind: SignalKind;
  area: SignalArea;
  evidence: Set<string>;
  count: number;
  maxConfidence: number;
}

/**
 * Detect signals from an already-scanned file list. `files` should include
 * `content` for the bounded set of text files worth probing; filename rules
 * work regardless.
 */
export function detectSignals(files: ScanFile[]): DetectedSignal[] {
  const acc = new Map<string, Acc>();

  const bump = (
    id: string,
    label: string,
    kind: SignalKind,
    area: SignalArea,
    evidencePath: string,
    confidence: number,
  ) => {
    let entry = acc.get(id);
    if (!entry) {
      entry = { label, kind, area, evidence: new Set(), count: 0, maxConfidence: 0 };
      acc.set(id, entry);
    }
    entry.count += 1;
    entry.maxConfidence = Math.max(entry.maxConfidence, confidence);
    if (entry.evidence.size < MAX_EVIDENCE) entry.evidence.add(evidencePath);
  };

  for (const f of files) {
    for (const rule of FILENAME_RULES) {
      if (rule.match(f)) bump(rule.id, rule.label, rule.kind, rule.area, f.path, rule.confidence ?? 0.9);
    }
    if (f.content) {
      for (const rule of detectPackageSignals(f)) {
        bump(rule.id, rule.label, rule.kind, rule.area, f.path, rule.confidence ?? 0.85);
      }
      for (const rule of CONTENT_RULES) {
        if (!rule.candidate(f)) continue;
        if (rule.re.test(f.content)) {
          bump(rule.id, rule.label, rule.kind, rule.area, f.path, rule.confidence ?? 0.75);
        }
      }
    }
  }

  // "kubernetes" is noise when a more specific GitOps signal already covers it.
  if (acc.has("flux") || acc.has("argocd")) {
    if (!acc.has("gitops")) {
      const src = acc.get("flux") ?? acc.get("argocd")!;
      acc.set("gitops", { label: "GitOps", kind: "pattern", area: "deploy", evidence: new Set(src.evidence), count: src.count, maxConfidence: 0.8 });
    }
  }

  return [...acc.entries()]
    .map(([id, e]) => ({
      id,
      label: e.label,
      kind: e.kind,
      area: e.area,
      evidence: [...e.evidence],
      count: e.count,
      confidence: Math.min(1, e.maxConfidence + Math.min(0.09, (e.count - 1) * 0.02)),
    }))
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
}

/** Extensions worth reading for content rules. Keeps content I/O bounded. */
export const CONTENT_EXTS = new Set([".yaml", ".yml", ".tf", ".tfvars", ".toml", ".json", ".ts", ".tsx", ".js", ".go", ".py"]);

/** True when a path is a plausible content-probe candidate for *some* rule. */
export function isContentCandidate(ext: string): boolean {
  return CONTENT_EXTS.has(ext);
}

function detectPackageSignals(file: ScanFile): PackageRule[] {
  if (file.base !== "package.json" || !file.content) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const manifest = parsed as Record<string, unknown>;
  const deps = new Set<string>();
  for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const group = manifest[key];
    if (!group || typeof group !== "object") continue;
    for (const name of Object.keys(group)) deps.add(name.toLowerCase());
  }
  return PACKAGE_RULES.filter((rule) => rule.packages.some((name) => deps.has(name.toLowerCase())));
}
