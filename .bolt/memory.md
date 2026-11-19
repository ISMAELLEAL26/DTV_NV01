# Project memory

## Product intent & audience

- Point of sale (POS) system for two store branches
- Modules: split-screen sales with promotional images, inventory, customer management, staff attendance, reports, cash drawer balancing, advanced statistics
- Spanish-language UI for Mexican end users (staff/management)

## Brand personality & voice

- Professional retail/POS interface; utility-focused with clear data presentation

## Visual design & UX direction

- Vite + React + Tailwind CSS + Lucide React icons (per `.bolt/prompt`)
- `@/` path alias for imports (maps to `src/`)
- Filter bars with period buttons (Día, Semana, Mes, Año) and date range inputs
- Reports show data tables with employee columns; "—" placeholder for null/missing employee
- Existing "Actualizar" (refresh) button pattern in report screens

## Decisions, constraints & rationale

- **Timezone:** Mexico City day boundaries (America/Mexico_City) must be used for all date-range queries, not UTC. UTC caused late-evening sales to fall outside the selected day.
- **Period buttons:** Calculate start dates using local Mexico timezone, not browser timezone.
- **Sales report sorting:** Already sorted most-recent → oldest (chronological descending) — no change needed.
- **Employee-less sales:** 13 sales (Oct 20–22) have no employee attached; they display "—" and are excluded from employee filters but still counted in totals.
- Sales are low-volume, so no pagination is needed currently.
- **Same timezone bug likely exists** in Estadísticas avanzadas and Nómina screens — pending fix.

## Open questions & assumptions

- Should the same timezone fix be applied to Estadísticas avanzadas and Nómina screens? (User hasn't confirmed yet)
- Are employee-less sales expected, or is there an upstream bug in the sales module that fails to attach the staff member?
- Do the two store branches need per-branch filtering in the sales report?
- What timezone do the server/database timestamps use? (Assumed UTC; Mexico conversion applied client-side)