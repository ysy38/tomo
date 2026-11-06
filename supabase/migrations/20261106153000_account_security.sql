-- Account verification and password reset live in the app database.
-- No policies: the server connects as the table owner. The Data API must not read tokens or mail.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.auth_challenges (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL,
  email text NOT NULL,
  purpose text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_challenges_token_hash ON public.auth_challenges (token_hash);
CREATE INDEX IF NOT EXISTS auth_challenges_email_purpose ON public.auth_challenges (email, purpose, created_at);

CREATE TABLE IF NOT EXISTS public.auth_mail (
  id uuid PRIMARY KEY,
  to_email text NOT NULL,
  purpose text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  delivered_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_mail_email_purpose ON public.auth_mail (to_email, purpose, created_at);

ALTER TABLE public.auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_mail ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auth_challenges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.auth_mail FROM PUBLIC, anon, authenticated;
