-- Take print_server_status out of the Realtime publication.
--
-- Every print-server heartbeat (an UPDATE per store every few seconds, ~588k so far) was decoded
-- by Realtime's change feed and checked against every postgres_changes subscriber, around the
-- clock. The only subscriber was the store settings page, which now polls instead (2026-10-09
-- shift-start outage follow-up). The top-bar printer indicator already polled.
--
-- Idempotent: a no-op when the table is already out of the publication.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'print_server_status'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.print_server_status;
  END IF;
END
$$;
