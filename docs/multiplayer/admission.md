# Ranked identity and admission

Ranked is disabled in production until the release checklist passes. Its local
test flag exercises four distinct Supabase accounts, explicit readiness and
human controllers only. Guest recovery credentials alone never qualify: HTTP
recovery and every new WebSocket admission verify the current token and require
the original account UUID. The configured Auth issuer binds that UUID to one
Supabase project; no platform account is linked automatically.

PostgreSQL admission runs inside the same transaction as room creation or the
accepted roster/start revision. Accounts are locked in sorted UUID order, with
durable cooldown and one unresolved-match lock checks. Locks are acquired when
a ranked seat is admitted. Pre-start departure releases its lock; starting
rechecks all four connected, ready humans and their cooldowns. After start the
account-to-color roster is immutable. A terminal started match retains its
locks until the unique settlement succeeds. A previously settled terminal
record cannot reacquire them when service metadata changes.

The ledger remains private under the dedicated schema and RLS boundary from
Task 7. No browser database access is added. Initial accounts start at 1200;
ranked consequences and settlement recovery are implemented in Task 11.

Acceptance: signed-token identity fixtures passed eight tests / 68 assertions.
The real SDK requires the matching verified account and four human readiness;
guest, wrong-account and revoked-token recovery are denied. The hosted
admission test passed three tests / 16 assertions using one disposable Supabase
schema, checking concurrent admission, persistent cooldown, pre-start release
and rollback of a disconnected fourth player at start. The schema was removed.
No live accounts, email, provider settings or deployment were changed.
