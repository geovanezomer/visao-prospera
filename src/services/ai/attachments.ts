// Processa anexos do chat: imagens (base64) e PDFs (texto extraído).

export interface ChatAttachment {
  id: string;
  name: string;
  size: number;
  type: "image" | "pdf";
  mime: string;
  /** Para imagens: data URL base64. Para PDF: undefined (texto vai em `text`). */
  dataUrl?: string;
  /** Para PDFs: texto extraído. */
  text?: string;
  error?: string;
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_MSG = 3;

export async function processFile(file: File): Promise<ChatAttachment> {
  const base: ChatAttachment = {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: file.name,
    size: file.size,
    type: file.type.startsWith("image/") ? "image" : "pdf",
    mime: file.type,
  };
  if (file.size > MAX_FILE_BYTES) {
    return { ...base, error: `Arquivo > ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.` };
  }
  if (file.type.startsWith("image/")) {
    base.dataUrl = await fileToDataUrl(file);
    return base;
  }
  if (file.type === "application/pdf") {
    try {
      base.text = await extractPdfText(file);
      if (!base.text.trim()) base.error = "PDF parece escaneado (sem texto extraído). OCR ainda não suportado.";
      return base;
    } catch (e: any) {
      return { ...base, error: `Falha ao ler PDF: ${e?.message || e}` };
    }
  }
  return { ...base, error: `Tipo não suportado: ${file.type}.` };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function extractPdfText(file: File): Promise<string> {
  // Lazy import — pesado.
  const pdfjs: any = await import("pdfjs-dist/build/pdf.mjs");
  // Worker via CDN para evitar configurar bundling
  try {
    const workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  } catch {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs`;
  }
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const maxPages = Math.min(doc.numPages, 50);
  const parts: string[] = [];
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((it: any) => it.str).join(" ");
    parts.push(`--- Página ${i} ---\n${pageText}`);
  }
  if (doc.numPages > maxPages) parts.push(`\n[Documento truncado: ${doc.numPages - maxPages} páginas adicionais não lidas]`);
  return parts.join("\n\n");
}

/** Constrói o trecho extra a anexar à mensagem do usuário com textos de PDFs. */
export function buildPdfContext(atts: ChatAttachment[]): string {
  const pdfs = atts.filter(a => a.type === "pdf" && a.text);
  if (!pdfs.length) return "";
  const sections = pdfs.map(a => `### 📎 Anexo PDF: ${a.name}\n\n${a.text}`);
  return `\n\n---\n${sections.join("\n\n---\n")}`;
}

/** Para chamada multimodal: parts no formato OpenAI vision. */
export function buildVisionMessageContent(text: string, atts: ChatAttachment[]): any {
  const images = atts.filter(a => a.type === "image" && a.dataUrl);
  if (!images.length) return text; // string normal
  return [
    { type: "text", text },
    ...images.map(img => ({ type: "image_url", image_url: { url: img.dataUrl! } })),
  ];
}
