export interface SsoIdentityMapper {
  memberForEmail(email: string): Promise<{ teamId: string; userId: string } | undefined>;
}

export function requireSsoOff(mode = process.env.GATEWAY_SSO_MODE ?? "off"): void {
  if (mode !== "off") throw new Error("Gateway SSO is not implemented; use GATEWAY_SSO_MODE=off.");
}
