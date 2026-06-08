import { createVaultRoutes } from "@/lib/vault/create-vault-routes";

export const { GET, PUT, POST, DELETE, PATCH } = createVaultRoutes("docs");
