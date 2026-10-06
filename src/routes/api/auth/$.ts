// Endpoints do Better Auth: /api/auth/sign-in/*, /api/auth/get-session etc.
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth.server";

const handle = ({ request }: { request: Request }) => auth().handler(request);

export const Route = createFileRoute("/api/auth/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
