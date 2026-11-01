import { z } from "zod";
import { IntegrationError } from "../integrations/types";
import { providers } from "../integrations/registry";

const statusSchema = z.object({
  configured: z.boolean(),
  fields: z.object({
    hasApiKey: z.boolean(),
    hasApplicationKey: z.boolean(),
    hasEmail: z.boolean(),
    hasScheduleId: z.boolean(),
    email: z.string(),
    scheduleId: z.string(),
    appOrigin: z.string(),
  }),
}).refine(({ configured, fields }) =>
  configured === (fields.hasApiKey && fields.hasApplicationKey) &&
  fields.hasEmail === !!fields.email && fields.hasScheduleId === !!fields.scheduleId,
);

const emptyFields = {
  hasApiKey: false,
  hasApplicationKey: false,
  hasEmail: false,
  hasScheduleId: false,
  email: "",
  scheduleId: "",
  appOrigin: "",
};

export async function readDatadogSetupStatus() {
  const unavailable = { available: false, failed: false, configured: false, fields: emptyFields };
  const failed = { ...unavailable, failed: true };
  try {
    const matches = providers().filter((provider) => provider.id === "datadog");
    if (matches.length === 0) return unavailable;
    if (matches.length !== 1 || typeof matches[0].setupStatus !== "function") return failed;
    const result = statusSchema.safeParse(await matches[0].setupStatus());
    return result.success ? { available: true, failed: false, ...result.data } : failed;
  } catch (error) {
    return error instanceof IntegrationError && error.kind === "unavailable" ? unavailable : failed;
  }
}
