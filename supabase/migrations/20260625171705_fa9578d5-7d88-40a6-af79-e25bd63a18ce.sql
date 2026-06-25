
-- Tabela para rate limiting distribuído (todos os workers compartilham).
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL
);
GRANT ALL ON public.rate_limit_buckets TO service_role;
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
-- Sem políticas: somente service_role (server-side) acessa.

CREATE INDEX IF NOT EXISTS idx_rl_reset ON public.rate_limit_buckets(reset_at);

-- Função atômica para incrementar/criar bucket. Retorna se está dentro do limite
-- e quanto falta para o reset. SECURITY DEFINER + service_role no GRANT abaixo.
CREATE OR REPLACE FUNCTION public.rl_consume(
  _key text,
  _limit integer,
  _window_seconds integer
) RETURNS TABLE(allowed boolean, remaining integer, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_reset timestamptz;
  v_count integer;
BEGIN
  INSERT INTO public.rate_limit_buckets (bucket_key, count, reset_at)
  VALUES (_key, 1, v_now + make_interval(secs => _window_seconds))
  ON CONFLICT (bucket_key) DO UPDATE
    SET count = CASE
                  WHEN public.rate_limit_buckets.reset_at < v_now THEN 1
                  ELSE public.rate_limit_buckets.count + 1
                END,
        reset_at = CASE
                     WHEN public.rate_limit_buckets.reset_at < v_now
                       THEN v_now + make_interval(secs => _window_seconds)
                     ELSE public.rate_limit_buckets.reset_at
                   END
  RETURNING count, reset_at INTO v_count, v_reset;

  RETURN QUERY SELECT
    (v_count <= _limit) AS allowed,
    GREATEST(_limit - v_count, 0) AS remaining,
    GREATEST(EXTRACT(EPOCH FROM (v_reset - v_now))::int, 0) AS retry_after_seconds;
END;
$$;

REVOKE ALL ON FUNCTION public.rl_consume(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rl_consume(text, integer, integer) TO service_role;

-- Limpeza periódica de buckets expirados (sem CRON; opcional).
CREATE OR REPLACE FUNCTION public.rl_gc() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.rate_limit_buckets WHERE reset_at < now() - interval '1 hour';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.rl_gc() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rl_gc() TO service_role;

-- Coluna opcional para reconciliação por método de pagamento.
ALTER TABLE public.checkout_intents
  ADD COLUMN IF NOT EXISTS payment_method text;
