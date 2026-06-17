// Processa anexos do chat: imagens (base64) e PDFs (texto extraído + OCR fallback).

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
  /** OCR foi usado para extrair? */
  ocrUsed?: boolean;
  /** Confiança média (0-100) quando OCR foi usado. */
  ocrConfidence?: number;
  /** Páginas processadas. */
  pagesProcessed?: number;
  error?: string;
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_MSG = 3;
const OCR_MAX_PAGES = 15; // limite por custo de tempo
const MIN_CHARS_PER_PAGE = 40; // abaixo disso → considera escaneado

export type OnProgress = (msg: string) => void;

export async function processFile(file: File, onProgress?: OnProgress): Promise<ChatAttachment> {
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
      onProgress?.(`Lendo ${file.name}…`);
      const { text, numPages } = await extractPdfText(file);
      const avgCharsPerPage =
        numPages > 0 ? text.replace(/--- Página \d+ ---/g, "").trim().length / numPages : 0;
      base.pagesProcessed = numPages;

      if (avgCharsPerPage >= MIN_CHARS_PER_PAGE) {
        base.text = text;
        return base;
      }

      // === Fallback OCR ===
      onProgress?.(`PDF escaneado detectado. Executando OCR…`);
      const ocr = await ocrPdf(file, onProgress);
      base.text = ocr.text;
      base.ocrUsed = true;
      base.ocrConfidence = ocr.confidence;
      base.pagesProcessed = ocr.pagesProcessed;
      if (!ocr.text.trim()) base.error = "OCR não extraiu texto utilizável.";
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

async function loadPdfjs(): Promise<any> {
  // @ts-expect-error - sem tipos para subpath
  const pdfjs: any = await import("pdfjs-dist/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@6.0.227/build/pdf.worker.min.mjs`;
  return pdfjs;
}

async function extractPdfText(file: File): Promise<{ text: string; numPages: number }> {
  const pdfjs = await loadPdfjs();
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
  if (doc.numPages > maxPages)
    parts.push(`\n[Documento truncado: ${doc.numPages - maxPages} páginas adicionais não lidas]`);
  return { text: parts.join("\n\n"), numPages: maxPages };
}

async function ocrPdf(
  file: File,
  onProgress?: OnProgress,
): Promise<{ text: string; confidence: number; pagesProcessed: number }> {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const maxPages = Math.min(doc.numPages, OCR_MAX_PAGES);

  const { createWorker } = await import("tesseract.js");
  const worker: any = await createWorker(["por", "eng"], 1, {
    logger: (m: any) => {
      if (m?.status === "recognizing text" && typeof m.progress === "number") {
        onProgress?.(`OCR ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  const parts: string[] = [];
  const confidences: number[] = [];

  try {
    for (let i = 1; i <= maxPages; i++) {
      onProgress?.(`OCR página ${i}/${maxPages}…`);
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2 }); // 2x = melhor OCR
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
      const { data } = await worker.recognize(canvas);
      parts.push(`--- Página ${i} (OCR) ---\n${data.text || ""}`);
      if (typeof data.confidence === "number") confidences.push(data.confidence);
      canvas.width = 0;
      canvas.height = 0; // libera memória
    }
  } finally {
    await worker.terminate();
  }

  if (doc.numPages > maxPages) {
    parts.push(`\n[OCR truncado: ${doc.numPages - maxPages} páginas adicionais não processadas]`);
  }

  const confidence = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;
  return { text: parts.join("\n\n"), confidence, pagesProcessed: maxPages };
}

/** Constrói o trecho extra a anexar à mensagem do usuário com textos de PDFs. */
export function buildPdfContext(atts: ChatAttachment[]): string {
  const pdfs = atts.filter((a) => a.type === "pdf" && a.text);
  if (!pdfs.length) return "";
  const sections = pdfs.map((a) => {
    const meta = a.ocrUsed
      ? `_(Extraído via OCR — confiança média: **${a.ocrConfidence?.toFixed(1)}%**${
          (a.ocrConfidence ?? 0) < 70 ? " — ⚠️ baixa, trate o conteúdo com ceticismo" : ""
        })_`
      : `_(Texto nativo do PDF — alta fidelidade)_`;
    return `### 📎 Anexo PDF: ${a.name}\n${meta}\n\n${a.text}`;
  });
  return `\n\n---\n${sections.join("\n\n---\n")}`;
}

/** Para chamada multimodal: parts no formato OpenAI vision. */
export function buildVisionMessageContent(text: string, atts: ChatAttachment[]): any {
  const images = atts.filter((a) => a.type === "image" && a.dataUrl);
  if (!images.length) return text; // string normal
  return [
    { type: "text", text },
    ...images.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl! } })),
  ];
}

export function confidenceLabel(c?: number): { label: string; tone: "ok" | "warn" | "bad" } {
  if (c === undefined) return { label: "—", tone: "ok" };
  if (c >= 85) return { label: `Alta (${c.toFixed(0)}%)`, tone: "ok" };
  if (c >= 70) return { label: `Média (${c.toFixed(0)}%)`, tone: "warn" };
  return { label: `Baixa (${c.toFixed(0)}%)`, tone: "bad" };
}
