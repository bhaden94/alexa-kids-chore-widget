---
name: alexa-skill-maintenance
description: 'Use when: editing this Alexa skill package, interaction model, APL widget, Data Store package, skill manifest, hosted endpoint, or Alexa client credentials guidance.'
argument-hint: 'maintain skill package or widget'
---

# Alexa Skill Maintenance

Use this skill when changing skill metadata, the interaction model, Lambda code, the APL widget package, or Data Store behavior.

## Project Facts

- Skill ID: `amzn1.ask.skill.0018dcbe-a1c5-4680-8dca-a51eecd906eb`
- Lambda code: `lambda/`
- Skill package: `skill-package/`
- Interaction model: `skill-package/interactionModels/custom/en-US.json`
- Widget package: `skill-package/dataStorePackages/kids-chore-chart/`
- Data Store namespace/key: `kidsChoreChart` / `widgetData`
- Alexa-hosted deployment branch: `master`
- Development/default branch: `main`

## Manifest Safety

- Keep `manifest.apis.custom.endpoint` and `manifest.apis.custom.regions` in `skill-package/skill.json`.
- Do not remove hosted endpoint metadata when editing interfaces or widget packages.
- Do not use raw SMAPI skill-package import unless explicitly requested.

## Widget Package Checks

When editing the widget package, validate all JSON-like files:

- `skill-package/dataStorePackages/kids-chore-chart/manifest.json`
- `skill-package/dataStorePackages/kids-chore-chart/datasources/default.json`
- `skill-package/dataStorePackages/kids-chore-chart/documents/document.json`
- `skill-package/dataStorePackages/kids-chore-chart/presentations/default.tpl`

Ensure `skill-package/skill.json` still declares package ID `kids-chore-chart` in the `ALEXA_DATASTORE_PACKAGEMANAGER` interface.

## Interaction Model Checks

- Avoid mixing `AMAZON.SearchQuery` with other slots in the same sample utterance.
- Keep sample utterances simple and compatible with Alexa model build validation.

## Credential Guidance

- Never commit real client secrets to Git.
- The Lambda expects `ALEXA_CLIENT_ID` and `ALEXA_CLIENT_SECRET` for Data Store token calls.
- If a safe hosted secret mechanism is not available, pause and ask the user before changing credential storage.
- Do not add secrets to `.github/skills`, README, logs, or committed source files.

## Validation Procedure

Before deployment:

1. Parse all changed JSON files.
2. Check `skill-package/skill.json` for hosted endpoint and widget package interface.
3. Check `lambda/index.js` for syntax with Node.js if Lambda changed.
4. Use the `alexa-hosted-deploy` skill for branch-based deployment.
