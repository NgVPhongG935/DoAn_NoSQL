-- Apply once before deploying the customer password-reset feature.
-- Existing customer rows and sessions remain valid until that customer's reset.
ALTER TABLE dat_xe_cong_nghe.customers ADD password_version text;
