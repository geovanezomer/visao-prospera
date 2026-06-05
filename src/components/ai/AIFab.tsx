import { useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AIChatSheet } from "./AIChatSheet";
import type { AppState } from "@/lib/finance/types";

interface Props {
  state: AppState;
  simulatedState?: AppState;
  simActive?: number;
}

export function AIFab({ state, simulatedState, simActive }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full shadow-lg"
        size="icon"
        title="Consultor IA — conversar com os dados"
      >
        <Bot className="h-5 w-5" />
      </Button>
      <AIChatSheet
        open={open}
        onOpenChange={setOpen}
        state={state}
        simulatedState={simulatedState}
        simActive={simActive}
      />
    </>
  );
}
