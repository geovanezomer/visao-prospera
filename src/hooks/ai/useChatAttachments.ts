// Hook focado em gerenciar anexos do chat (PDF/imagem com OCR).
// Extraído de useAIChat para isolar UI-state de upload/processamento.

import { useState } from "react";
import { toast } from "sonner";
import {
  processFile,
  confidenceLabel,
  MAX_FILES_PER_MSG,
  type ChatAttachment,
} from "@/engines/ai/attachments";

export interface UseChatAttachmentsReturn {
  attachments: ChatAttachment[];
  setAttachments: React.Dispatch<React.SetStateAction<ChatAttachment[]>>;
  removeAttachment: (id: string) => void;
  processingFile: boolean;
  processingMsg: string;
  handleFiles: (files: FileList | null) => Promise<void>;
}

export function useChatAttachments(): UseChatAttachmentsReturn {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [processingFile, setProcessingFile] = useState(false);
  const [processingMsg, setProcessingMsg] = useState<string>("");

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_FILES_PER_MSG - attachments.length;
    if (remaining <= 0) {
      toast.error(`Máx ${MAX_FILES_PER_MSG} anexos por mensagem.`);
      return;
    }
    const toProcess = Array.from(files).slice(0, remaining);
    setProcessingFile(true);
    try {
      const results: ChatAttachment[] = [];
      for (const f of toProcess) {
        setProcessingMsg(`Lendo ${f.name}…`);
        const att = await processFile(f, (m) => setProcessingMsg(m));
        if (att.error) toast.error(`${att.name}: ${att.error}`);
        else if (att.ocrUsed) {
          const lbl = confidenceLabel(att.ocrConfidence);
          if (lbl.tone === "bad")
            toast.warning(`${att.name}: OCR com confiança ${lbl.label}. Revise antes de usar.`);
          else toast.success(`${att.name}: OCR concluído — confiança ${lbl.label}.`);
        }
        results.push(att);
      }
      setAttachments((prev) => [...prev, ...results]);
    } finally {
      setProcessingFile(false);
      setProcessingMsg("");
    }
  };

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  return {
    attachments,
    setAttachments,
    removeAttachment,
    processingFile,
    processingMsg,
    handleFiles,
  };
}
