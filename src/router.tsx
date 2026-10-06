import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // QueryClient com defaults estáveis: evita refetches desnecessários em
  // foco/reconnect e remove o "flash" entre cache e fetch nas queries frias
  // (app_settings, planos públicos, conteúdo legal).
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  // Leva ao navegador o cache que os loaders preencheram no SSR (ex.:
  // app_settings com marca e cores). Sem isso o cliente começava com o cache
  // vazio, renderizava diferente do servidor (erro de hidratação #418) e
  // buscava tudo de novo. O QueryClientProvider continua no RootComponent.
  setupRouterSsrQueryIntegration({ router, queryClient, wrapQueryClient: false });

  return router;
};
