# Kids Chore Chart Alexa Widget Architecture

## Product goals

Build an Alexa widget and skill that helps a household track kids' chores and rewards.

Core requirements:

- Support multiple kids from the start.
- Each chore can be worth a different number of points.
- Chores can optionally have a due date and/or due time.
- Chores can be one-time or recurring.
- Parents can award bonus points for things outside the set chore list.
- Rewards are purchased/redeemed with points.
- Widgets should be glanceable on the default Alexa widget size, while the data and UI architecture should support richer/larger views when available.

## Alexa platform shape

Alexa widgets are delivered as an APL package under `skill-package/dataStorePackages/{packageId}`. The installed widget reads changing data from the local device Data Store through the `alexaext:datastore:10` extension.

The skill backend is responsible for:

1. Receiving widget lifecycle events.
2. Receiving `Alexa.Presentation.APL.UserEvent` events from widget taps.
3. Updating persistent household data.
4. Pushing a compact widget projection to the device Data Store.

The widget itself should never be the source of truth. It only renders the latest Data Store projection and sends intent-like events back to Lambda.

## Data ownership

### Source of truth

DynamoDB-backed persistent attributes are the initial source of truth for the prototype.

Longer term, this can migrate to explicit DynamoDB tables without changing the widget contract.

### Widget projection

The Alexa Data Store receives a compact projection at:

- Namespace: `kidsChoreChart`
- Key: `widgetData`

The projection is optimized for APL rendering, not complete data storage.

## Domain model

### Household

Represents one Alexa user/household.

Important fields:

- `schemaVersion`
- `timeZone`
- `selectedChildId`
- `children`
- `chores`
- `rewards`
- `completions`
- `transactions`
- `lastMessage`

### Child

Represents one kid.

Fields:

- `childId`
- `name`
- `currentPoints`
- `lifetimePoints`
- `emoji`
- `color`

`currentPoints` is the spendable balance. `lifetimePoints` tracks all earned points before reward redemptions.

### Chore

Reusable chore definition.

Fields:

- `choreId`
- `title`
- `assignedChildIds`
- `pointValue`
- `active`
- `emoji`
- `sortOrder`
- optional `dueDate`
- optional `dueTime`
- optional `recurrence`

Due date/time is optional. A chore can exist without a due time.

### Recurrence

Prototype recurrence shape:

```json
{
  "type": "DAILY"
}
```

Supported design targets:

- `NONE` — one-time chore. If `dueDate` is set, it appears only on that date.
- `DAILY` — appears every day after `startDate`, if set.
- `WEEKLY` — appears on configured `daysOfWeek`.
- `MONTHLY` — future option.

### Chore occurrence

A chore definition produces a dated occurrence for a child.

Occurrence identity:

```text
{date}#{childId}#{choreId}
```

This ID prevents double-awarding points for repeated taps.

### Chore completion

Stored by occurrence ID.

Fields:

- `occurrenceId`
- `childId`
- `choreId`
- `date`
- `completedAt`
- `pointsAwarded`

### Point transaction

Ledger entry for every point change.

Fields:

- `transactionId`
- `childId`
- `type`
- `points`
- `reason`
- `createdAt`
- optional `choreId`
- optional `occurrenceId`

Transaction types:

- `CHORE_COMPLETED`
- `BONUS`
- `REWARD_REDEEMED`
- `ADJUSTMENT`

The ledger is the audit trail. The child balance is cached for fast widget rendering.

### Reward

Rewards are optional spend targets.

Fields:

- `rewardId`
- `title`
- `cost`
- `active`

Redeeming a reward creates a negative `PointTransaction`.

## Widget interaction flow

### Complete chore

1. Widget sends `completeChore`, `childId`, `choreId`, and `date`.
2. Lambda loads household state.
3. Lambda computes the occurrence ID.
4. If already completed, Lambda does not award points again.
5. If not completed:
   - create completion record
   - create positive `CHORE_COMPLETED` transaction
   - increment child balance
6. Lambda pushes updated `widgetData` to Data Store.
7. Widget updates inline.

### Bonus points

Prototype supports a widget button that awards `+1` bonus point to the selected child.

Planned voice flow:

- “Alexa, give Emma five points for helping clean up.”
- “Alexa, add ten bonus points to Jack.”

This creates a `BONUS` transaction with a free-form reason.

### Select child

Widget sends `selectNextChild`. Lambda rotates `selectedChildId` and pushes a new projection.

## Widget Data Store projection

Example shape:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-05-10T20:00:00.000Z",
  "today": "2026-05-10",
  "selectedChildId": "emma",
  "selectedChild": {
    "childId": "emma",
    "name": "Emma",
    "emoji": "🌟",
    "currentPoints": 18,
    "lifetimePoints": 18,
    "completedChores": 1,
    "totalChores": 3,
    "nextReward": {
      "title": "Extra screen time",
      "cost": 50,
      "pointsToGo": 32
    },
    "chores": [
      {
        "choreId": "make-bed",
        "title": "Make bed",
        "emoji": "🛏️",
        "pointValue": 10,
        "dueLabel": "Due 8:30 AM",
        "completed": true,
        "overdue": false
      }
    ]
  },
  "childrenSummary": [],
  "lastMessage": "Emma earned 10 points for Make bed."
}
```

The current widget renders only the selected child and the first few chores. The projection intentionally includes enough detail for future expanded/full-screen views.

## Larger widget and detail strategy

Current public Alexa widget documentation focuses on `WIDGET_M` / `@hubWidgetMedium`. This prototype therefore ships a medium widget, but keeps the architecture ready for richer surfaces:

- Data projection can include more chores and all child summaries.
- APL can use responsive conditions and viewport dimensions to show more detail when the available viewport is larger.
- A full-screen skill APL view can act as today’s “large widget” experience.
- If Alexa later exposes additional widget targets, add another package/layout target that reuses the same backend and projection.

## Initial test scope

The first testable slice includes:

- Two seeded kids.
- Three seeded recurring chores.
- One selected-child widget.
- Tap a chore to award its point value once per day.
- Tap `Bonus +1` to award arbitrary bonus points.
- Tap `Next kid` to rotate selected child.
- Push updates to Alexa Data Store for device testing.
