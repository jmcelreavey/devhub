/**
 * Capability Radar — hands-on lab workspace scaffolder.
 *
 * Turns a generated lab into a ready-to-run training directory the learner can
 * actually work in. Everything scaffolded here is DETERMINISTIC (no model) so it
 * never hallucinates: the lab markdown becomes the README, a checklist is
 * derived from the lab's section headings, and a docker-compose.yml is assembled
 * from a small map of signal → service (Mongo, Postgres, Redis, Kafka, …).
 *
 * The workspace is a "kitchen-sink" repo that grows one directory per lab, kept
 * at the repos root (a sibling of your clones) so it's easy to find and version
 * yourself. Idempotent: regenerating a lab rewrites its directory.
 */

import fs from "node:fs";
import path from "node:path";
import { getReposScanDir } from "@/lib/repos";
import { safeSegment } from "./paths";

/** Local services a lab benefits from, keyed by signal id (or label keyword). */
interface ServiceDef {
  name: string;
  compose: string; // YAML block under `services:` (2-space indented)
  env?: string[]; // .env.example lines
}

const SERVICES: Record<string, ServiceDef> = {
  mongo: {
    name: "mongo",
    compose: [
      "  mongo:",
      "    image: mongo:7",
      "    restart: unless-stopped",
      "    ports: ['27017:27017']",
      "    volumes: ['./data/mongo:/data/db']",
    ].join("\n"),
    env: ["MONGO_URL=mongodb://localhost:27017/lab"],
  },
  postgres: {
    name: "postgres",
    compose: [
      "  postgres:",
      "    image: postgres:16",
      "    restart: unless-stopped",
      "    environment:",
      "      POSTGRES_USER: lab",
      "      POSTGRES_PASSWORD: lab",
      "      POSTGRES_DB: lab",
      "    ports: ['5432:5432']",
      "    volumes: ['./data/postgres:/var/lib/postgresql/data']",
    ].join("\n"),
    env: ["DATABASE_URL=postgres://lab:lab@localhost:5432/lab"],
  },
  redis: {
    name: "redis",
    compose: ["  redis:", "    image: redis:7", "    restart: unless-stopped", "    ports: ['6379:6379']"].join("\n"),
    env: ["REDIS_URL=redis://localhost:6379"],
  },
  kafka: {
    name: "kafka",
    compose: [
      "  kafka:",
      "    image: bitnami/kafka:3.7",
      "    restart: unless-stopped",
      "    ports: ['9092:9092']",
      "    environment:",
      "      KAFKA_CFG_NODE_ID: '0'",
      "      KAFKA_CFG_PROCESS_ROLES: controller,broker",
      "      KAFKA_CFG_CONTROLLER_QUORUM_VOTERS: 0@kafka:9093",
      "      KAFKA_CFG_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093",
      "      KAFKA_CFG_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092",
      "      KAFKA_CFG_CONTROLLER_LISTENER_NAMES: CONTROLLER",
    ].join("\n"),
    env: ["KAFKA_BROKER=localhost:9092"],
  },
};

/** Map a signal id / label to the services worth spinning up for the lab. */
export function servicesForSignal(signalId: string, label: string): ServiceDef[] {
  const hay = `${signalId} ${label}`.toLowerCase();
  const picked = new Set<ServiceDef>();
  if (/mongo|atlas/.test(hay)) picked.add(SERVICES.mongo);
  if (/postgres|rds|sql/.test(hay)) picked.add(SERVICES.postgres);
  if (/redis|cache/.test(hay)) picked.add(SERVICES.redis);
  if (/kafka|event|messaging|stream/.test(hay)) picked.add(SERVICES.kafka);
  return [...picked];
}

function buildCompose(services: ServiceDef[]): string {
  return ["services:", ...services.map((s) => s.compose), ""].join("\n");
}

/** Turn the lab's `## N. Title` headings into a checklist. */
export function stepsFromMarkdown(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((l) => l.match(/^##\s+(.*)$/)?.[1]?.trim())
    .filter((s): s is string => !!s);
}

export interface LabWorkspaceInput {
  category: string;
  repoName: string;
  signalId: string;
  label: string;
  markdown: string;
  remoteUrl: string | null;
  evidencePaths: string[];
  /** Optional AI-generated starter files (written under `starter/`). */
  starter?: { files: { path: string; content: string }[]; run?: string } | null;
}

export interface LabWorkspaceResult {
  workspacePath: string;
  services: string[];
  /** Relative paths of starter files written under `starter/`. */
  starterFiles: string[];
}

/** Root of the kitchen-sink training repo (sibling of your clones). */
export function labsRoot(): string {
  return path.join(getReposScanDir(), "kitchen-sink");
}

/** Absolute workspace directory for a lab (whether or not it exists yet). */
export function labWorkspaceDir(repoName: string, signalId: string): string {
  return path.join(labsRoot(), safeSegment(`${repoName}__${signalId}`));
}

/**
 * Relative paths (`starter/...`) of files under a workspace's starter dir —
 * used to record what the OpenCode agent wrote there.
 */
export function listStarterFiles(workspacePath: string): string[] {
  const starterDir = path.join(workspacePath, "starter");
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
      } else if (entry.isFile()) {
        out.push(path.relative(workspacePath, full).replace(/\\/g, "/"));
      }
    }
  };
  walk(starterDir);
  return out.sort().slice(0, 50);
}

/**
 * Scaffold (or refresh) the lab's workspace directory. Best-effort: returns null
 * if the filesystem can't be written (the lab itself still works).
 */
export function scaffoldLabWorkspace(input: LabWorkspaceInput): LabWorkspaceResult | null {
  try {
    const dir = labWorkspaceDir(input.repoName, input.signalId);
    fs.mkdirSync(dir, { recursive: true });

    const services = servicesForSignal(input.signalId, input.label);
    const steps = stepsFromMarkdown(input.markdown);

    // Top-level README for the kitchen-sink repo (create once).
    const rootReadme = path.join(labsRoot(), "README.md");
    if (!fs.existsSync(rootReadme)) {
      fs.writeFileSync(
        rootReadme,
        [
          "# Kitchen Sink — DevHub training labs",
          "",
          "Hands-on training workspaces generated by Capability Radar. Each directory is one",
          "lab: a README with the training path, a checklist, and any local services it needs.",
          "",
          "```bash",
          "cd <lab-dir>",
          "docker compose up -d   # if the lab has services",
          "```",
          "",
        ].join("\n"),
      );
    }

    // Lab README = the training path.
    const originLink = input.remoteUrl ? `[${input.repoName}](${input.remoteUrl})` : `\`${input.repoName}\``;
    const readme = [
      `# ${input.label} — lab (${input.repoName})`,
      "",
      `Grounded in ${originLink}. Work through \`STEPS.md\`; use \`README.md\` as the reference.`,
      services.length
        ? `\nSpin up local services first:\n\n\`\`\`bash\ndocker compose up -d\n\`\`\`\n`
        : "\n_No local services required for this lab._\n",
      "---",
      "",
      input.markdown,
    ].join("\n");
    fs.writeFileSync(path.join(dir, "README.md"), readme);

    // Checklist.
    fs.writeFileSync(
      path.join(dir, "STEPS.md"),
      [`# ${input.label} — checklist`, "", ...steps.map((s) => `- [ ] ${s}`), ""].join("\n"),
    );

    // docker-compose + env when there are services.
    if (services.length) {
      fs.writeFileSync(path.join(dir, "docker-compose.yml"), buildCompose(services));
      const env = services.flatMap((s) => s.env ?? []);
      if (env.length) fs.writeFileSync(path.join(dir, ".env.example"), env.join("\n") + "\n");
    }

    fs.writeFileSync(path.join(dir, ".gitignore"), ["node_modules/", ".env", "data/", ""].join("\n"));

    // AI-generated starter source (defensively re-validated against the dir).
    const starterFiles: string[] = [];
    if (input.starter?.files?.length) {
      const starterDir = path.join(dir, "starter");
      const starterRoot = path.resolve(starterDir);
      for (const f of input.starter.files) {
        const dest = path.resolve(starterDir, f.path);
        if (dest !== starterRoot && !dest.startsWith(starterRoot + path.sep)) continue; // never escape starter/
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, f.content);
        starterFiles.push(path.relative(dir, dest).replace(/\\/g, "/"));
      }
      if (starterFiles.length) {
        const runLine = input.starter.run ? `\n\nRun:\n\n\`\`\`bash\n${input.starter.run}\n\`\`\`` : "";
        fs.writeFileSync(
          path.join(starterDir, "GENERATED.md"),
          `# Starter (AI-generated)\n\nThese files are a generated starting point grounded in \`${input.repoName}\` — review before trusting them.${runLine}\n`,
        );
      }
    }

    return { workspacePath: dir, services: services.map((s) => s.name), starterFiles };
  } catch {
    return null;
  }
}
