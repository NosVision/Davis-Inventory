-- P3.3 review: defense-in-depth for the financial hr_claims table.
-- MED: back the app-layer ฿1,000,000 ceiling with a DB CHECK so no future code path
-- (bulk import, P4 adjustment, refactor) can insert an unbounded amount.
ALTER TABLE hr_claims
  ADD CONSTRAINT hr_claims_amount_ceiling CHECK (amount_satang <= 100000000);

-- LOW: explicit deny-all DELETE policy (mirrors hr_leaves) — RLS already defaults deny,
-- but be explicit for a table holding financial records (use status='cancelled' instead).
DROP POLICY IF EXISTS hr_claims_delete_policy ON hr_claims;
CREATE POLICY hr_claims_delete_policy ON hr_claims
  FOR DELETE TO authenticated USING (false);
