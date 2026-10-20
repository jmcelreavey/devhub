import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { exitWithParent } from "../../../shared/process/exit-with-parent.ts";
import { createContext } from "./context.ts";
import { createTaskPlanServer } from "./plan-peer.ts";

const scope = { taskId: process.env.DEVHUB_PLAN_TASK_ID ?? "", date: process.env.DEVHUB_PLAN_TASK_DATE ?? "" };
const server = createTaskPlanServer(createContext(), scope);
await server.connect(new StdioServerTransport());
exitWithParent();
