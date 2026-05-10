# Alexa Kids Chore Widget

Prototype Alexa skill and widget for a multi-child chore chart with points and rewards.

## What is implemented now

- Seeded household with two kids.
- Seeded recurring chores with different point values.
- Widget Data Store projection at namespace `kidsChoreChart`, key `widgetData`.
- Widget interactions:
  - complete a chore
  - add `+1` bonus point
  - cycle to the next child
- Lambda persistence through the ASK DynamoDB persistence adapter.

## Project layout

- `lambda/` — Alexa skill backend.
- `skill-package/` — ASK skill package.
- `skill-package/dataStorePackages/kids-chore-chart/` — APL widget package.
- `docs/architecture.md` — architecture and data model.
- `docs/implementation-state.md` — current implementation state and handoff notes.

## First device test

1. Deploy this skill to the Alexa development stage.
2. Configure Lambda environment variables:
   - `ALEXA_CLIENT_ID`
   - `ALEXA_CLIENT_SECRET`
3. Build the interaction model.
4. Open the Alexa developer console.
5. Go to **Multimodal Responses > Widget**.
6. Install/send the widget to a supported Echo Show device.
7. Test:
   - `Next kid`
   - `Bonus +1`
   - tapping an incomplete chore row

## Deployment

This project is managed as an Alexa-hosted skill through Git. Keep normal development on `main`. When changes are ready for the Alexa development stage, merge `main` into `master` and push `master`.

Alexa-hosted branch behavior:

- `main` — normal GitHub default branch for day-to-day development.
- `master` — deployment branch. Pushing this branch is equivalent to clicking **Deploy** in the Alexa Developer Console Code tab.

Deploy from a clean working tree:

   ```powershell
   git checkout main
   git pull --ff-only origin main
   git checkout master
   git pull --ff-only origin master
   git merge main
   git push origin master
   git checkout main
   ```

If `master` does not exist yet, create it once from `main`:

   ```powershell
   git checkout main
   git checkout -b master
   git push -u origin master
   git checkout main
   ```

Do not use raw SMAPI skill-package import for this hosted skill. Raw imports can replace the Alexa-hosted endpoint configuration and cause the Developer Console warning that the default endpoint changed.

The remaining `scripts/build-lambda-zip.ps1` helper is only for the Developer Console **Code > Import Code** fallback flow. It is not the normal deployment path.

## Copilot skills

This repo includes project-scoped Copilot skills under `.github/skills/`:

- `alexa-hosted-deploy` — branch-based deployment from `main` to `master`.
- `alexa-skill-maintenance` — safe edits for the skill manifest, interaction model, widget package, hosted endpoint, and credentials guidance.

## Notes

The prototype uses `WIDGET_M`, because Alexa public widget docs currently describe medium widgets as the supported widget viewport. Larger/detail experiences should be handled with responsive/full-screen APL until additional widget targets are available.
