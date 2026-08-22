ALTER TABLE protection_receipts
  ADD COLUMN IF NOT EXISTS model_provider text,
  ADD COLUMN IF NOT EXISTS provider_payload_hash text,
  ADD COLUMN IF NOT EXISTS provider_payload_bytes integer,
  ADD COLUMN IF NOT EXISTS provider_payload_status text,
  ADD COLUMN IF NOT EXISTS boundary_scans jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE protection_receipts
  DROP CONSTRAINT IF EXISTS protection_receipts_provider_payload_status_check;

ALTER TABLE protection_receipts
  ADD CONSTRAINT protection_receipts_provider_payload_status_check
  CHECK (provider_payload_status IS NULL OR provider_payload_status IN ('protected','blocked','not_called'));
