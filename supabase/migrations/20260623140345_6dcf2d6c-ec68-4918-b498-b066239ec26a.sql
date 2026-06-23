
CREATE OR REPLACE FUNCTION public.shared_reports_enforce_readonly()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.share_id      IS DISTINCT FROM OLD.share_id      THEN RAISE EXCEPTION 'shared_reports: share_id é imutável'; END IF;
  IF NEW.owner_id      IS DISTINCT FROM OLD.owner_id      THEN RAISE EXCEPTION 'shared_reports: owner_id é imutável'; END IF;
  IF NEW.storage_path  IS DISTINCT FROM OLD.storage_path  THEN RAISE EXCEPTION 'shared_reports: storage_path é imutável'; END IF;
  IF NEW.company_name  IS DISTINCT FROM OLD.company_name  THEN RAISE EXCEPTION 'shared_reports: company_name é imutável'; END IF;
  IF NEW.created_at    IS DISTINCT FROM OLD.created_at    THEN RAISE EXCEPTION 'shared_reports: created_at é imutável'; END IF;
  -- expires_at e revoked_at podem ser alterados pelo dono via server fn.
  RETURN NEW;
END;
$$;
