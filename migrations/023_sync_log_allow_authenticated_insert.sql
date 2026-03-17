DROP POLICY IF EXISTS sync_log_insert_authenticated ON sync_log;
CREATE POLICY sync_log_insert_authenticated ON sync_log
  FOR INSERT TO authenticated WITH CHECK (true);

