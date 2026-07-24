-- Bank-account verification for payroll transfers (client ask 2026-07-24).
-- Employees type their own bank details at self-registration, and the bank pays by
-- account NUMBER — a wrong-but-existing number sends money to a stranger. HR now ticks
-- "ตรวจบัญชีแล้ว" after checking the number against the real book/slip; the bank-payment
-- export quarantines unverified rows so they can never ride along into the upload file.
-- Any change to the account number or bank resets the flag (enforced in the API layer).

ALTER TABLE hr_employees
  ADD COLUMN IF NOT EXISTS bank_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_verified_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS bank_verified_at TIMESTAMPTZ;

-- Normalize the free-text bank names already in prod so the per-bank grouping works:
-- 'kbank'/'Kbang' were hand-typed variants of KBANK; 'cash'/'X' were placeholders for
-- "no account" (paid in cash) → NULL, which the export groups into the cash file.
UPDATE hr_employees SET bank_name = 'KBANK' WHERE bank_name ILIKE 'kban%';
UPDATE hr_employees SET bank_name = NULL WHERE bank_name IN ('cash', 'X');
