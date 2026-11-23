-- Run once more after this run (W17 review, E18-62). Set by enqueue({ key, rerunIfRunning: true })
-- when a job with the same key is already running: work that reads its list when it starts (push
-- delivery, tracker sends) would otherwise miss what was added during the run. Cleared when the job
-- is claimed; a run that finishes with it set queues a follow-up run with the same key.
alter table jobs add column rerun boolean not null default false;
