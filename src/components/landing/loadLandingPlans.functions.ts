// ============================================================================
// RPC wrapper para loadLandingPlans — expõe o helper server-only via
// createServerFn, permitindo o consumo por loader de rota sem arrastar
// dependências server-only (@tanstack/react-start/server, admin/audit) para
// o bundle do cliente.
// ============================================================================
import { createServerFn } from "@tanstack/react-start";
import type { LandingPlans } from "./loadLandingPlans.server";

export const getLandingPlans = createServerFn({ method: "GET" }).handler(
  async (): Promise<LandingPlans> => {
    const { loadLandingPlans } = await import("./loadLandingPlans.server");
    return loadLandingPlans();
  },
);
