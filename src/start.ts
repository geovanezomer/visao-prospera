import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    const { recordError } = await import("./lib/ops/errors.server");
    await recordError("server", error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Login por cookie httpOnly (Better Auth): o navegador envia a sessão sozinho,
// sem middleware de cliente anexando token.
export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
}));
