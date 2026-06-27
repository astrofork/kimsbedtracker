# Pending Decision: Nurse Access — Hard Delete vs Soft Delete

## The Question

When a ward is removed from a nursing station, should the nurse access assignments be:

**A) Permanently deleted (current behaviour)**
**B) Kept as inactive and restored when the ward comes back (soft-delete)**
c)

---

## Current Behaviour (Hard Delete)

When Ward X is removed from Station A:

- All `nurse_access_assignments` rows for Station A nurses on Ward X are deleted permanently
- If Ward X is later added back to Station A, nurses start with zero access — manager must reassign from scratch

**Pros:**

- Clean slate — no ghost data in the DB
- Intentional: new assignment = explicit decision by manager
- Simple to reason about

**Cons:**

- If a ward is moved out by mistake and added back, the manager has to redo all bed assignments manually
- No memory of previous access (bed lists lost)

---

## Alternative Behaviour (Soft Delete)

When Ward X is removed from Station A:

- Assignments are marked `status = 'inactive'` instead of deleted
- Bed names and access type are preserved in the row

When Ward X is added back to Station A:

- Assignments for Station A nurses are automatically set back to `status = 'active'`
- Previous bed lists are restored exactly as they were

**Pros:**

- No data loss — accidental moves are fully reversible
- Manager does not need to redo assignments after a ward returns

**Cons:**

- Stale data stays in DB (inactive rows accumulate)
- If the ward is moved to Station B first, then back to Station A, it restores old Station A access which may be outdated
- Slightly more complex logic

---

## What Changes in Code (if soft-delete is chosen)

| File                                             | Change                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `bedflow-backend/src/services/managerService.ts` | `assignWardsToStation()` — replace DELETE with UPDATE status='inactive'; on re-add restore status='active' |
| `bedflow-backend/src/services/managerService.ts` | `listNurseAccess()` — default filter to status='active' (already done)                                     |
| No frontend changes needed                       | The Access tab already filters by status='active'                                                          |

---

## Decision Needed

Please confirm which behaviour you want:

- [ ] **A — Keep hard delete** (current, clean slate on every move)
- [ ] **B — Switch to soft delete** (remember and restore access when ward returns)
