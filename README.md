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

## Deployment scripts

- To upload Lambda code only in the Alexa Developer Console **Code > Import Code** flow, run `scripts/build-lambda-zip.ps1` and upload `dist/lambda-import.zip`.
- To push the full ASK skill package, including the widget package under `skill-package/dataStorePackages/`, install/configure ASK CLI and run:

   ```powershell
   npm install -g ask-cli
   ask configure --profile default
   .\scripts\deploy-skill-package.ps1 -SkillId amzn1.ask.skill.YOUR-SKILL-ID -Profile default
   ```

The full package deployment is the one that makes the widget appear under **Build > Multimodal Responses > Widget**.

## Notes

The prototype uses `WIDGET_M`, because Alexa public widget docs currently describe medium widgets as the supported widget viewport. Larger/detail experiences should be handled with responsive/full-screen APL until additional widget targets are available.
