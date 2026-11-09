-- Request counters stay on the server. The Data API must not read or write them.
CREATE TABLE IF NOT EXISTS public.auth_limits (
  id uuid PRIMARY KEY,
  key_hash text NOT NULL,
  purpose text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_limits_lookup ON public.auth_limits (purpose, key_hash, created_at);
ALTER TABLE public.auth_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_limits FROM PUBLIC, anon, authenticated;

-- The browser key must not read the question bank, answer keys, or learner rows,
-- even if a policy is added later or RLS is turned off by mistake.
REVOKE ALL ON TABLE
  public.profiles,
  public.sessions,
  public.session_items,
  public.answers,
  public.mastery,
  public.reviews,
  public.plans,
  public.subscriptions,
  public.events,
  public.drill_answers,
  public.items,
  public.choices,
  public.stimuli,
  public.skills,
  public.vocabulary,
  public.vocab_links,
  public.item_skills,
  public.item_vocabulary,
  public.app_meta,
  public.auth_challenges,
  public.auth_mail
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
