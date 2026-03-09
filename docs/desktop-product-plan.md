# Desktop Product Plan

## Product thesis

Most personal finance tools optimize for narrow mobile flows. This app should optimize for sustained desktop decision-making:

- one long-form workspace instead of deep navigation
- visible month splits instead of hidden transaction drilldowns
- debt-by-debt payoff ledgers instead of isolated account pages
- recommendations that stay explainable and editable

## Core information architecture

The first usable version should keep these regions on the same screen:

1. Setup rail
   Collect pay-window budgets, monthly flex, and debt inputs without pushing the user into a separate wizard.
2. Recommendation strip
   Surface the focus debt, payoff horizon, projected interest, and budget stress signals.
3. Monthly planner band
   Show consecutive months as cards or columns.
   Each month contains:
   - first-half payment table
   - second-half payment table
   - totals and headroom
4. Debt ledger band
   One ledger per debt with:
   - month
   - amount owed
   - amount paid
   - amount left
   - percent left

## Interaction model

- Desktop-first by default: wide layout, dense information, large visible tables.
- Progressive editing: the user edits assumptions in the left rail and sees the full planner recalculate immediately.
- Scroll, not navigate: the user should mostly move vertically and horizontally through visible data rather than opening pages.
- Recommendation, not autopilot: strategy is suggested clearly, but the user should eventually be able to override it.

## Calculation roadmap

### Scaffolded now

- manual debt inputs
- monthly split budgets
- avalanche recommendation
- projected month tables
- per-debt ledgers

### Next calculation improvements

1. Real due dates within each half-month window.
2. Income dates and paycheck-specific allocation.
3. Strategy toggle: avalanche, snowball, custom.
4. Interest model options by debt type.
5. Hard shortfall handling when minimums exceed available budget.

## Desktop UX priorities

1. Preserve glanceability.
   A user should understand the next few months without opening a modal.
2. Preserve editability.
   Changing one APR or payment amount should be low-friction.
3. Preserve alignment.
   Tables should line up visually so month-to-month comparison is easy.
4. Preserve hierarchy.
   Monthly planning and debt ledgers should feel connected but distinct.

## Delivery sequence

1. Stabilize the local desktop app shell and planning model.
2. Add saved plans, import/export, and local database persistence.
3. Add richer payoff strategies and manual overrides.
4. Add printable/exportable reports.
5. Add account sync only if it does not break the desktop-first clarity.
