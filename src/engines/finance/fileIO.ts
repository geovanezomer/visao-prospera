// Helpers browser-only para download/upload de arquivos .finnance.
// Padrão Excalidraw: Blob + <a download> para salvar; <input type="file"> para abrir.
import { FinnanceFile, FINNANCE_FILE_EXT, parseFinnanceFile } from "./fileFormat";
import type { AppState, Scenario } from "./types";

/** Baixa o payload como arquivo .finnance. */
export function downloadFinnanceFile(payload: FinnanceFile, filename: string): void {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(FINNANCE_FILE_EXT) ? filename : `${filename}${FINNANCE_FILE_EXT}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Libera memória após o navegador iniciar o download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Abre o file picker e retorna o conteúdo já validado + nome do arquivo. */
export function pickFinnanceFile(): Promise<{
  state: AppState;
  scenarios: Scenario[];
  extras: { actions: unknown[]; simScenarios: unknown[]; memories: unknown[] };
  file: FinnanceFile;
  filename: string;
  originalVersion: number;
  currentVersion: number;
  migrated: boolean;
}> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `${FINNANCE_FILE_EXT},application/json`;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error("Nenhum arquivo selecionado."));
        return;
      }
      try {
        const text = await file.text();
        const raw = JSON.parse(text);
        const parsed = parseFinnanceFile(raw);
        resolve({ ...parsed, filename: file.name });
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Falha ao ler o arquivo."));
      }
    };
    input.click();
  });
}
