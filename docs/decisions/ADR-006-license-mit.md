# ADR-006 · MIT licence

**Date** 2026-09-11 · **Status** accepted

## Decision

SOTA is published under the MIT licence, copyright Oscar Lozano.

## Why

- Maximally permissive: a school, a studio or a company can adopt, embed or host it without a
  copyleft review, which is the adoption we want for a tool whose value is being _simple to run_.
- The project's moat is not the code but the model (relying party + entitlement contract); a
  closed hosted fork does not hurt the reference deployment.

## Consequences

- Contributions are accepted under the same licence (implicit in-bound = out-bound).
- Rejected: AGPL-3.0 (the spec's other candidate; it would keep hosted forks open at the cost of
  friction for exactly the small organisations we target). Revisit only if a hosted competitor
  becomes a real problem.
