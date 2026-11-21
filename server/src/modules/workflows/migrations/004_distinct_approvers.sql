-- A different person per step (wave 9, AZ-7). A step may carry `distinct_approvers: true` in its
-- JSON: someone who decided another step of the same request may not decide it. The default Risk
-- acceptance workflow asks for it on its "Executive approver" step; installations that already have
-- that workflow get the rule on that step too (identified by its key, so a step an administrator
-- renamed keeps it, and a workflow whose steps were replaced is left alone). Running requests keep
-- the copy of the workflow they started with.
update workflow_definitions d
   set steps = (
     select jsonb_agg(case when s ->> 'key' = 'executive' and not (s ? 'distinct_approvers')
                           then s || '{"distinct_approvers": true}'::jsonb else s end
                      order by t.ord)
       from jsonb_array_elements(d.steps) with ordinality as t(s, ord)),
       updated_at = now()
 where d.kind = 'risk_acceptance'
   and jsonb_typeof(d.steps) = 'array'
   and exists (select 1 from jsonb_array_elements(d.steps) e where e ->> 'key' = 'executive' and not (e ? 'distinct_approvers'));
