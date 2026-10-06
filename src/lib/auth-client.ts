// Cliente de login (navegador). Fala com /api/auth/* — ver lib/auth.server.ts.
import { createAuthClient } from "better-auth/react";
import {
  adminClient,
  inferAdditionalFields,
  magicLinkClient,
  usernameClient,
} from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.APP_URL ?? "http://localhost:3000"),
  plugins: [
    usernameClient(),
    adminClient(),
    magicLinkClient(),
    inferAdditionalFields({
      user: {
        aiEnabled: { type: "boolean", input: false },
        isTrial: { type: "boolean", input: false },
        trialExpiresAt: { type: "date", required: false, input: false },
        mustChangePassword: { type: "boolean", input: false },
        role: { type: "string", input: false },
      },
    }),
  ],
});
