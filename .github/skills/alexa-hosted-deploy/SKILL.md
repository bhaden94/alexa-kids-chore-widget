---
name: alexa-hosted-deploy
description: 'Use when: deploying this Alexa-hosted skill, pushing to master, merging main into master, checking hosted skill deployment status, or avoiding SMAPI import endpoint issues.'
argument-hint: 'deploy from main to master'
---

# Alexa Hosted Deploy

Use this skill when the user asks to deploy, push to Alexa, publish to the development stage, merge `main` to `master`, or manage the Alexa-hosted branch workflow.

## Rules

- Keep `main` as the default development branch.
- Treat `master` as the Alexa-hosted deployment branch.
- Pushing `master` is equivalent to clicking **Deploy** in the Alexa Developer Console Code tab.
- Do not use `scripts/deploy-skill-package.ps1`; it was intentionally removed.
- Do not use raw SMAPI skill-package import for normal deploys. It can overwrite the hosted endpoint configuration.
- Do not change the endpoint to a self-hosted endpoint unless the user explicitly requests it.

## Pre-deploy Checks

1. Verify the working tree is clean or confirm the user wants to deploy uncommitted changes.
2. Verify the current branch is `main` or switch back to `main` before starting.
3. Run lightweight validation before deploying:
   - JSON parse `skill-package/skill.json`
   - JSON parse `skill-package/interactionModels/custom/en-US.json`
   - JSON parse widget package JSON/TPL files under `skill-package/dataStorePackages/`
4. Confirm `skill-package/skill.json` keeps `manifest.apis.custom.endpoint` and `manifest.apis.custom.regions` for the Alexa-hosted Lambda endpoint.

## Deploy Procedure

Run commands from the repository root:

1. Update `main`:
   - `git checkout main`
   - `git pull --ff-only origin main`
2. Ensure `master` exists:
   - If `origin/master` exists: `git checkout master` then `git pull --ff-only origin master`
   - If `origin/master` does not exist: `git checkout -b master main`
3. Merge `main` into `master`:
   - `git merge main`
4. Push deployment branch:
   - `git push -u origin master`
5. Return to development branch:
   - `git checkout main`
6. If ASK CLI is configured, verify status:
   - `ask smapi get-skill-status --skill-id amzn1.ask.skill.ba2c7f7a-a96d-4ad2-bb3f-a2e5c7092375 --profile default`

## If Merge Conflicts Occur

- Stop and resolve conflicts deliberately.
- Prefer `main` for project source files unless `master` contains Alexa-generated endpoint metadata that is missing from `main`.
- Re-run validation after resolving conflicts.

## If the Developer Console Shows Endpoint Warning

1. Check whether `skill-package/skill.json` still contains `manifest.apis.custom.endpoint` and `manifest.apis.custom.regions`.
2. Do not run a raw SMAPI skill package import.
3. If the console has a **Use Alexa hosted endpoint** button, use it once, fetch the manifest with ASK CLI, and preserve the endpoint/regions in `skill-package/skill.json`.
