// ============================================================================
// OdooTab — chave seletora Manual | Odoo, conexão (URL, banco, chave de API),
// escolha das empresas, sincronização e ajuste da classificação de contas.
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Database, Loader2, PlugZap, RefreshCw, Save, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  getOdooSettings,
  listAccountClassifications,
  saveOdooSettings,
  setAccountOverride,
  setDataSource,
  syncOdooNow,
  testOdooConnection,
  type AccountClassificationRow,
  type OdooSettingsView,
} from "@/lib/odoo/odoo.functions";
import type { OdooCompanyInfo } from "@/engines/odoo/types";
import { BS_BUCKET_LABELS, PL_LINE_LABELS } from "@/engines/odoo/mapping";
import { cn } from "@/lib/utils";

const TARGET_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(PL_LINE_LABELS).map(([k, v]) => [k, `DRE · ${v}`])),
  ...Object.fromEntries(Object.entries(BS_BUCKET_LABELS).map(([k, v]) => [k, `Balanço · ${v}`])),
  ignore: "Ignorar",
};

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR") : "—";
}

export function OdooTab() {
  const [settings, setSettings] = useState<OdooSettingsView | null>(null);
  const [form, setForm] = useState({ url: "", database: "", apiKey: "", historyMonths: 24 });
  const [companyIds, setCompanyIds] = useState<number[]>([]);
  const [companies, setCompanies] = useState<OdooCompanyInfo[] | null>(null);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "test" | "save" | "sync" | "mode">(null);
  const [rows, setRows] = useState<AccountClassificationRow[]>([]);
  const [filter, setFilter] = useState("");

  const load = async () => {
    const s = await getOdooSettings();
    setSettings(s);
    setForm({ url: s.url, database: s.database, apiKey: "", historyMonths: s.historyMonths });
    setCompanyIds(s.companyIds);
    setRows(await listAccountClassifications());
  };

  useEffect(() => {
    load().catch((e) => toast.error(e instanceof Error ? e.message : "Falha ao carregar."));
  }, []);

  const test = async () => {
    setBusy("test");
    try {
      const r = await testOdooConnection({
        data: { url: form.url, database: form.database, apiKey: form.apiKey || undefined },
      });
      if (!r.ok) {
        setCompanies(null);
        toast.error(r.error);
        return;
      }
      setCompanies(r.companies);
      setServerVersion(r.serverVersion);
      toast.success(
        `Conectado${r.serverVersion ? ` ao Odoo ${r.serverVersion}` : ""} — ${r.companies.length} empresa(s).`,
      );
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    try {
      await saveOdooSettings({
        data: {
          url: form.url,
          database: form.database,
          apiKey: form.apiKey || undefined,
          companyIds,
          historyMonths: form.historyMonths,
        },
      });
      toast.success("Conexão salva.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    try {
      const r = await syncOdooNow();
      if (r.ok)
        toast.success(
          `Sincronizado: ${r.companies} empresa(s) em ${(r.durationMs / 1000).toFixed(1)}s.`,
        );
      else toast.error(r.error ?? "Falha na sincronização.");
      await load();
    } finally {
      setBusy(null);
    }
  };

  const switchMode = async (mode: "manual" | "odoo") => {
    if (settings?.dataSource === mode) return;
    setBusy("mode");
    try {
      await setDataSource({ data: { mode } });
      toast.success(mode === "odoo" ? "Modo Odoo ativado." : "Modo manual ativado.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível trocar o modo.");
    } finally {
      setBusy(null);
    }
  };

  const override = async (code: string, target: string) => {
    try {
      await setAccountOverride({ data: { code, target: target === "__auto" ? null : target } });
      setRows(await listAccountClassifications());
      toast.success("Classificação atualizada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    }
  };

  const visibleRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? rows.filter((r) => `${r.code} ${r.name}`.toLowerCase().includes(q)) : rows;
  }, [rows, filter]);

  if (!settings) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  const roots = companies?.filter((c) => !c.parentId) ?? [];
  const toggleCompany = (id: number, on: boolean) =>
    setCompanyIds((ids) => (on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)));

  return (
    <div className="space-y-6">
      {/* Chave seletora */}
      <section className="rounded-lg border border-border/60 p-4">
        <h3 className="mb-1 text-sm font-semibold">Origem dos dados do cockpit</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          <strong>Manual</strong>: análises e simulações com dados digitados (consultoria).{" "}
          <strong>Odoo</strong>: o realizado vem do ERP desta empresa e fica somente leitura;
          premissas (regime, custo de capital, cenários) continuam editáveis.
        </p>
        <div
          className="inline-flex rounded-md border border-border p-0.5"
          role="radiogroup"
          aria-label="Origem dos dados"
        >
          {(["manual", "odoo"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={settings.dataSource === m}
              disabled={busy === "mode"}
              onClick={() => void switchMode(m)}
              className={cn(
                "rounded px-4 py-1.5 text-xs font-medium transition-colors",
                settings.dataSource === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {m === "manual" ? "Manual" : "Odoo"}
            </button>
          ))}
        </div>
      </section>

      {/* Conexão */}
      <section className="rounded-lg border border-border/60 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <PlugZap className="h-4 w-4" /> Conexão com o Odoo (19 ou superior)
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="odoo-url">URL</Label>
            <Input
              id="odoo-url"
              placeholder="https://erp.suaempresa.com.br"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="odoo-db">Banco de dados</Label>
            <Input
              id="odoo-db"
              placeholder="producao"
              value={form.database}
              onChange={(e) => setForm({ ...form, database: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="odoo-key">Chave de API</Label>
            <Input
              id="odoo-key"
              type="password"
              autoComplete="off"
              placeholder={settings.apiKeyMasked ?? "Cole a chave gerada no Odoo"}
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground">
              No Odoo: Preferências → Segurança da conta → Nova chave de API, escopo{" "}
              <code>rpc</code>. Use um usuário com o perfil “Contabilidade – somente leitura”. A
              chave fica cifrada no servidor.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="odoo-months">Histórico (meses)</Label>
            <Input
              id="odoo-months"
              type="number"
              min={12}
              max={60}
              value={form.historyMonths}
              onChange={(e) => setForm({ ...form, historyMonths: Number(e.target.value) || 24 })}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void test()} disabled={busy !== null}>
            {busy === "test" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlugZap className="mr-1.5 h-3.5 w-3.5" />
            )}
            Testar conexão
          </Button>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={busy !== null || !form.url || !form.database}
          >
            {busy === "save" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Salvar
          </Button>
        </div>

        {companies && (
          <div className="mt-4 rounded-md bg-muted/40 p-3">
            <p className="mb-2 text-xs font-medium">
              Empresas no Odoo{serverVersion ? ` ${serverVersion}` : ""} — marque as que entram no
              cockpit (filiais acompanham a matriz). Nenhuma marcada = todas.
            </p>
            <ul className="space-y-1.5">
              {roots.map((r) => (
                <li key={r.id} className="text-xs">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={companyIds.includes(r.id)}
                      onCheckedChange={(v) => toggleCompany(r.id, v === true)}
                    />
                    <span className="font-medium">{r.name}</span>
                    {r.vat && <span className="text-muted-foreground">CNPJ {r.vat}</span>}
                    {r.lockDate && (
                      <Badge variant="outline" className="text-[10px]">
                        fechado até {r.lockDate}
                      </Badge>
                    )}
                  </label>
                  {companies
                    .filter((b) => b.parentId === r.id)
                    .map((b) => (
                      <div key={b.id} className="ml-8 text-muted-foreground">
                        ↳ {b.name} (filial)
                      </div>
                    ))}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Clique em “Salvar” para gravar a seleção.
            </p>
          </div>
        )}
      </section>

      {/* Sincronização */}
      <section className="rounded-lg border border-border/60 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Database className="h-4 w-4" /> Sincronização
        </h3>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            {settings.lastSyncStatus === "ok" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : settings.lastSyncStatus === "error" ? (
              <XCircle className="h-4 w-4 text-destructive" />
            ) : null}
            Última: {fmtDate(settings.lastSyncAt)}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void sync()}
            disabled={busy !== null || !settings.hasApiKey || !settings.url}
          >
            {busy === "sync" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Sincronizar agora
          </Button>
          <span className="text-muted-foreground">
            Com o modo Odoo ligado, sincroniza sozinho a cada hora.
          </span>
        </div>
        {settings.lastError && (
          <p className="mt-2 rounded bg-destructive/10 p-2 text-xs text-destructive">
            {settings.lastError}
          </p>
        )}
      </section>

      {/* Classificação de contas */}
      {rows.length > 0 && (
        <section className="rounded-lg border border-border/60 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Classificação das contas</h3>
              <p className="text-xs text-muted-foreground">
                Automática pelo plano referencial (ECD). Ajuste uma conta se ela cair na linha
                errada — vale na hora.
              </p>
            </div>
            <Input
              className="h-8 w-56"
              placeholder="Filtrar por código ou nome"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="max-h-[480px] overflow-auto rounded border border-border/40">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="text-left">
                  <th className="p-2">Conta</th>
                  <th className="p-2">Tipo Odoo</th>
                  <th className="p-2">Classificação</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.code} className="border-t border-border/30">
                    <td className="p-2">
                      <span className="font-mono">{r.code}</span> {r.name}
                    </td>
                    <td className="p-2 text-muted-foreground">{r.type}</td>
                    <td className="p-2">
                      <select
                        aria-label={`Classificação da conta ${r.code}`}
                        className={cn(
                          "h-7 w-full rounded border border-border bg-background px-1",
                          r.override && "border-primary",
                        )}
                        value={r.override ?? "__auto"}
                        onChange={(e) => void override(r.code, e.target.value)}
                      >
                        <option value="__auto">
                          Automática: {TARGET_LABELS[r.current] ?? r.current}
                        </option>
                        {Object.entries(TARGET_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
