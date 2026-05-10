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
- For this Alexa-hosted skill, push the full project through the hosted Git repository. This deploys `lambda/`, `skill-package/`, and the widget package without changing the hosted endpoint setting:

   ```powershell
   npm install -g ask-cli
   ask configure --profile default
   .\scripts\deploy-skill-package.ps1 -SkillId amzn1.ask.skill.YOUR-SKILL-ID -Profile default
   ```

The script uses the Alexa-hosted CodeCommit `master` branch by default when `-SkillId` points to a hosted skill. It keeps a temporary clone under `dist/alexa-hosted-deploy/`, commits the local `lambda/`, `skill-package/`, and `ask-resources.json`, then pushes to hosted `master`.

Do not use raw SMAPI skill-package import for this hosted skill unless you explicitly mean to replace the hosted endpoint configuration. Raw import can cause the Developer Console warning that the default endpoint changed.

## Notes

The prototype uses `WIDGET_M`, because Alexa public widget docs currently describe medium widgets as the supported widget viewport. Larger/detail experiences should be handled with responsive/full-screen APL until additional widget targets are available.
