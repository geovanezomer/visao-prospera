import { useState } from "react";
import { Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

// Tópicos pré-definidos para a caixa de seleção.
const TOPICS = [
  "Sugestão de melhoria",
  "Reportar bug",
  "Nova funcionalidade",
  "Dúvida sobre cálculo financeiro",
  "Dúvida sobre Reforma Tributária (CBS/IBS)",
  "Performance / UX",
  "Outro",
];

/**
 * Diálogo de Sugestões e Melhorias.
 * Envia via POST /api/feedback (server route) → Resend API.
 * Credenciais ficam em .env do servidor (RESEND_API_KEY, FEEDBACK_FROM, FEEDBACK_TO).
 */
export function FeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<string>("");
  const [otherTopic, setOtherTopic] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const reset = () => {
    setTopic("");
    setOtherTopic("");
    setSubject("");
    setMessage("");
  };

  const handleSend = async () => {
    if (!topic || !subject.trim() || !message.trim()) {
      toast.error("Preencha tópico, assunto e mensagem.");
      return;
    }
    if (topic === "Outro" && !otherTopic.trim()) {
      toast.error("Descreva o tópico em 'Outro'.");
      return;
    }
    setSending(true);
    try {
      const finalTopic = topic === "Outro" ? otherTopic.trim() : topic;
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: finalTopic,
          subject: subject.trim(),
          message: message.trim(),
          appVersion: import.meta.env.VITE_APP_VERSION ?? undefined,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? `Falha ao enviar (HTTP ${res.status}).`);
        return;
      }
      toast.success("Sugestão enviada — obrigado!");
      reset();
      setOpen(false);
    } catch (err) {
      console.error("[feedback] send error:", err);
      toast.error("Erro de rede ao enviar sugestão.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          title="Sugestões e melhorias"
          aria-label="Enviar sugestão"
        >
          <Mail className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sugestões e Melhorias</DialogTitle>
          <DialogDescription>
            Compartilhe ideias, reporte problemas ou solicite novas funcionalidades.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="fb-topic">Tópico</Label>
            <Select value={topic} onValueChange={setTopic}>
              <SelectTrigger id="fb-topic">
                <SelectValue placeholder="Selecione um tópico" />
              </SelectTrigger>
              <SelectContent>
                {TOPICS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {topic === "Outro" && (
            <div className="space-y-2">
              <Label htmlFor="fb-other">Especifique</Label>
              <Input
                id="fb-other"
                value={otherTopic}
                onChange={(e) => setOtherTopic(e.target.value)}
                placeholder="Descreva o tópico"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="fb-subject">Assunto</Label>
            <Input
              id="fb-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Resumo curto"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="fb-message">Mensagem</Label>
            <Textarea
              id="fb-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Detalhe sua sugestão ou problema..."
              rows={6}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? "Enviando..." : "Enviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
