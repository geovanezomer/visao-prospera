/** URL pública canônica. Client: VITE_APP_URL (build-time). SSR: APP_URL (runtime). */
export function getBaseUrl(): string {
  const client = import.meta.env?.VITE_APP_URL as string | undefined;
  const server = typeof process !== "undefined" ? process.env.APP_URL : undefined;
  return (client || server || "http://localhost:3000").replace(/\/+$/, "");
}
