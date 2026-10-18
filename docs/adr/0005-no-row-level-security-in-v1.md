# ADR 0005: No Postgres row-level security in v1

Status: accepted (2026-10-18)

## Context

Standing is multi-tenant: organizers of one tenant must never see or change another tenant's venues, events, orders, exports or documents. Postgres row-level security (RLS) could enforce this in the database.

## Decision

RLS is not used in v1. Isolation rests on two things:

1. **One middleware.** `requireTenantRole(min)` (`apps/api/src/authz.ts`) is the only authorization point for `/tenants/:tenantId/*`. A non-member gets 404 (the tenant's existence is not revealed), a member with too low a role gets 403. Every handler that loads a child row (event, venue, document) filters on `tenant_id` as well as the row id.
2. **One matrix test.** `apps/api/src/authz.matrix.test.ts` runs every tenant route × role × "member of another tenant" and fails when a registered route is neither in the matrix nor explicitly exempt, or when a matrix row no longer matches a route.

## Consequences

- A missing tenant filter inside a handler is caught by tests (the matrix for the route, plus cross-tenant tests in the route test files), not by the database. There is no database-level backstop; the README says so.
- The buyer flow (storefront, holds, payment) crosses tenants by design and stays simple.

## Alternatives rejected

RLS was considered and rejected for v1 because:

- it needs a transaction-scoped `SET LOCAL app.tenant_id` on every request and a pooled connection discipline to make sure it is never missing or leaked;
- it needs a non-owner database role for the application (table owners bypass RLS), which complicates migrations and tests;
- the buyer flow reads and writes across tenants, so policies would need exceptions that are easy to get wrong;
- the matrix test already fails on the most likely mistake (a new route without a check).
