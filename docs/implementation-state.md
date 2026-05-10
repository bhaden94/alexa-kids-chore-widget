# Implementation State

Last updated: 2026-05-10

## Current phase

Prototype slice 1: testable Alexa widget with seeded multiple-kid chore and points data.

## Completed

- Created local project structure under `D:\repos\alexa-kids-chore-widget`.
- Documented the architecture in `docs/architecture.md`.
- Planned a minimal Data Store projection using namespace `kidsChoreChart` and key `widgetData`.

## In progress

- Scaffolding a minimal ASK-compatible project.
- Implementing Lambda handlers for:
  - widget install/update lifecycle events
  - chore completion
  - selected-child rotation
  - bonus point award
- Implementing APL widget package for a medium Alexa widget.
- Retesting installed-widget inline touch actions on a physical Echo Show device.

## Latest device test note

- The widget installs and displays seeded data, but the first physical-device test did not visibly react to tapping chore rows, `Next kid`, or `Bonus +1`.
- The widget document now gives each tappable area an explicit component ID/accessibility label and exposes a `statusMessage` component for inline `ExecuteCommands` feedback.
- The Lambda `Alexa.Presentation.APL.UserEvent` handler now returns an inline `ExecuteCommands` status update after each tap, so a successful tap should visibly change the status line even before the Data Store projection refreshes.
- The widget package version was bumped to `0.1.1` so an already-installed widget can receive the updated APL document after deployment.
- If the status line reports that Data Store credentials are needed, set `ALEXA_CLIENT_ID` and `ALEXA_CLIENT_SECRET`; otherwise taps may be handled by Lambda but the widget will continue showing static package seed data.

## Intended first test

1. Deploy the skill/package to Alexa development stage.
2. Set Lambda environment variables:
   - `ALEXA_CLIENT_ID`
   - `ALEXA_CLIENT_SECRET`
3. Build the interaction model.
4. In the Alexa developer console, install/send the widget to a device.
5. Verify:
   - widget shows seeded kids/chore data
   - `Next kid` changes the selected child
   - tapping a chore marks it complete and awards points once
   - `Bonus +1` increases selected child points
   - tapping any widget action updates the status line, which confirms `Alexa.Presentation.APL.UserEvent` reached Lambda

## Current prototype data

Seed children:

- Emma
- Jack

Seed chores:

- Make bed — 10 points — daily — due 8:30 AM
- Brush teeth — 5 points — daily — due 8:00 PM
- Feed pet — 15 points — daily — no due time

Seed rewards:

- Pick dessert — 25 points
- Extra screen time — 50 points

## Known platform constraints

- Alexa public widget docs currently center on medium widgets: `WIDGET_M` / `@hubWidgetMedium`.
- Larger widget support is represented in the architecture as richer projections and future responsive/full-screen layouts, not as a currently enabled `WIDGET_L` target.

## Next planned work

- Add full-screen APL dashboard for all kids.
- Add voice setup for children and chores.
- Add voice bonus points with free-form reason.
- Add reward redemption flow.
- Expand recurrence support beyond daily.
- Add tests for chore idempotency and point ledger updates.
