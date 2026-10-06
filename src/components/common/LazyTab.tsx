// ============================================================================
// LazyTab — utilitário para fatiar conteúdo de abas em chunks dinâmicos.
//
// Usado em telas com múltiplas sub-seções em <Tabs> (Admin, Calculadoras),
// onde só uma é renderizada por vez. Em vez de importar estaticamente todos
// os componentes (que entram no bundle inicial), criamos um wrapper com
// React.lazy + Suspense que carrega o chunk apenas quando a aba é ativada.
// ============================================================================
import { lazy, Suspense, type ComponentType } from "react";
import { Skeleton } from "@/components/ui/skeleton";

function TabSkeleton() {
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

/**
 * Cria um componente lazy a partir de um import dinâmico de export nomeado.
 * Evita ter que adicionar `export default` em cada arquivo destino.
 *
 * @example
 *   const UsersTab = lazyNamed(() => import("./UsersTab"), "UsersTab");
 */
export function lazyNamed<T extends Record<string, ComponentType<unknown>>, K extends keyof T>(
  loader: () => Promise<T>,
  name: K,
): ComponentType<Record<string, unknown>> {
  const Lazy = lazy(async () => {
    const mod = await loader();
    return { default: mod[name] as ComponentType<Record<string, unknown>> };
  });
  return function LazyTabContent(props: Record<string, unknown>) {
    return (
      <Suspense fallback={<TabSkeleton />}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
