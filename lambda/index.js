const Alexa = require('ask-sdk-core');
const axios = require('axios');
const AWS = require('aws-sdk');
const ddbAdapter = require('ask-sdk-dynamodb-persistence-adapter');

const DATASTORE_NAMESPACE = 'kidsChoreChart';
const DATASTORE_KEY = 'widgetData';
const ALEXA_CLIENT_ID = process.env.ALEXA_CLIENT_ID || '';
const ALEXA_CLIENT_SECRET = process.env.ALEXA_CLIENT_SECRET || '';

const DEFAULT_HOUSEHOLD = {
    schemaVersion: 1,
    timeZone: 'America/New_York',
    selectedChildId: 'emma',
    lastMessage: 'Tap a chore to earn points.',
    children: [
        {
            childId: 'emma',
            name: 'Emma',
            emoji: '🌟',
            color: '#FFE082',
            currentPoints: 0,
            lifetimePoints: 0
        },
        {
            childId: 'jack',
            name: 'Jack',
            emoji: '🚀',
            color: '#90CAF9',
            currentPoints: 0,
            lifetimePoints: 0
        }
    ],
    chores: [
        {
            choreId: 'make-bed',
            title: 'Make bed',
            emoji: '🛏️',
            assignedChildIds: ['emma', 'jack'],
            pointValue: 10,
            active: true,
            dueTime: '08:30',
            recurrence: {
                type: 'DAILY'
            },
            sortOrder: 10
        },
        {
            choreId: 'brush-teeth',
            title: 'Brush teeth',
            emoji: '🪥',
            assignedChildIds: ['emma', 'jack'],
            pointValue: 5,
            active: true,
            dueTime: '20:00',
            recurrence: {
                type: 'DAILY'
            },
            sortOrder: 20
        },
        {
            choreId: 'feed-pet',
            title: 'Feed pet',
            emoji: '🐾',
            assignedChildIds: ['emma', 'jack'],
            pointValue: 15,
            active: true,
            recurrence: {
                type: 'DAILY'
            },
            sortOrder: 30
        }
    ],
    rewards: [
        {
            rewardId: 'pick-dessert',
            title: 'Pick dessert',
            cost: 25,
            active: true
        },
        {
            rewardId: 'screen-time',
            title: 'Extra screen time',
            cost: 50,
            active: true
        }
    ],
    completions: {},
    transactions: []
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function getDefaultHousehold() {
    return clone(DEFAULT_HOUSEHOLD);
}

function ensureHousehold(attributes) {
    if (!attributes.household || attributes.household.schemaVersion !== 1) {
        attributes.household = getDefaultHousehold();
    }

    const household = attributes.household;
    household.children = household.children || [];
    household.chores = household.chores || [];
    household.rewards = household.rewards || [];
    household.completions = household.completions || {};
    household.transactions = household.transactions || [];

    if (!household.selectedChildId && household.children[0]) {
        household.selectedChildId = household.children[0].childId;
    }

    return household;
}

function getTodayString() {
    return new Date().toISOString().slice(0, 10);
}

function getChild(household, childId) {
    return household.children.find(child => child.childId === childId);
}

function findChildByName(household, name) {
    if (!name) {
        return undefined;
    }

    const normalizedName = name.trim().toLowerCase();
    return household.children.find(child => child.name.toLowerCase() === normalizedName);
}

function getSelectedChild(household) {
    return getChild(household, household.selectedChildId) || household.children[0];
}

function getOccurrenceId(date, childId, choreId) {
    return `${date}#${childId}#${choreId}`;
}

function choreAppliesToDate(chore, date) {
    if (!chore.active) {
        return false;
    }

    if (chore.startDate && date < chore.startDate) {
        return false;
    }

    if (chore.endDate && date > chore.endDate) {
        return false;
    }

    const recurrenceType = chore.recurrence && chore.recurrence.type ? chore.recurrence.type : 'NONE';

    if (recurrenceType === 'DAILY') {
        return true;
    }

    if (recurrenceType === 'WEEKLY') {
        const daysOfWeek = chore.recurrence.daysOfWeek || [];
        const dayIndex = new Date(`${date}T00:00:00Z`).getUTCDay();
        const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
        return daysOfWeek.includes(dayNames[dayIndex]);
    }

    if (chore.dueDate) {
        return chore.dueDate === date;
    }

    return true;
}

function formatDueLabel(chore) {
    if (chore.dueDate && chore.dueTime) {
        return `Due ${chore.dueDate} ${formatTime(chore.dueTime)}`;
    }

    if (chore.dueDate) {
        return `Due ${chore.dueDate}`;
    }

    if (chore.dueTime) {
        return `Due ${formatTime(chore.dueTime)}`;
    }

    return 'Any time';
}

function formatTime(time) {
    const [hourText, minuteText] = time.split(':');
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function isOverdue(date, chore, completed) {
    if (completed || !chore.dueTime) {
        return false;
    }

    const today = getTodayString();
    if (date < today) {
        return true;
    }

    if (date > today) {
        return false;
    }

    const [dueHourText, dueMinuteText] = chore.dueTime.split(':');
    const dueHour = Number(dueHourText);
    const dueMinute = Number(dueMinuteText);
    const now = new Date();

    return now.getHours() > dueHour || (now.getHours() === dueHour && now.getMinutes() > dueMinute);
}

function getChoreOccurrencesForChild(household, childId, date) {
    return household.chores
        .filter(chore => chore.assignedChildIds.includes(childId))
        .filter(chore => choreAppliesToDate(chore, date))
        .sort((first, second) => (first.sortOrder || 0) - (second.sortOrder || 0))
        .map(chore => {
            const occurrenceId = getOccurrenceId(date, childId, chore.choreId);
            const completion = household.completions[occurrenceId];
            const completed = Boolean(completion);

            return {
                occurrenceId,
                choreId: chore.choreId,
                title: chore.title,
                emoji: chore.emoji || '⭐',
                pointValue: chore.pointValue || 0,
                dueDate: chore.dueDate || '',
                dueTime: chore.dueTime || '',
                dueLabel: formatDueLabel(chore),
                completed,
                overdue: isOverdue(date, chore, completed),
                completedAt: completion ? completion.completedAt : ''
            };
        });
}

function getNextReward(household, child) {
    const activeRewards = household.rewards
        .filter(reward => reward.active)
        .sort((first, second) => first.cost - second.cost);

    if (activeRewards.length === 0) {
        return {
            title: 'No reward yet',
            cost: 0,
            pointsToGo: 0
        };
    }

    const nextReward = activeRewards.find(reward => reward.cost > child.currentPoints) || activeRewards[activeRewards.length - 1];

    return {
        rewardId: nextReward.rewardId,
        title: nextReward.title,
        cost: nextReward.cost,
        pointsToGo: Math.max(nextReward.cost - child.currentPoints, 0)
    };
}

function buildChildSummary(household, child, date) {
    const chores = getChoreOccurrencesForChild(household, child.childId, date);
    return {
        childId: child.childId,
        name: child.name,
        emoji: child.emoji,
        currentPoints: child.currentPoints || 0,
        lifetimePoints: child.lifetimePoints || 0,
        completedChores: chores.filter(chore => chore.completed).length,
        totalChores: chores.length
    };
}

function buildWidgetData(household) {
    const today = getTodayString();
    const selectedChild = getSelectedChild(household);
    const selectedChildSummary = buildChildSummary(household, selectedChild, today);
    const chores = getChoreOccurrencesForChild(household, selectedChild.childId, today).slice(0, 5);

    return {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        today,
        selectedChildId: selectedChild.childId,
        selectedChild: {
            ...selectedChildSummary,
            color: selectedChild.color,
            nextReward: getNextReward(household, selectedChild),
            chores
        },
        childrenSummary: household.children.map(child => buildChildSummary(household, child, today)),
        recentTransactions: household.transactions.slice(0, 5),
        lastMessage: household.lastMessage || 'Tap a chore to earn points.'
    };
}

function addPointTransaction(household, child, transaction) {
    const points = Number(transaction.points) || 0;
    child.currentPoints = Math.max((child.currentPoints || 0) + points, 0);

    if (points > 0) {
        child.lifetimePoints = (child.lifetimePoints || 0) + points;
    }

    household.transactions.unshift({
        transactionId: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        ...transaction,
        points
    });

    household.transactions = household.transactions.slice(0, 100);
}

function completeChore(household, childId, choreId, date) {
    const child = getChild(household, childId);
    const chore = household.chores.find(item => item.choreId === choreId);

    if (!child || !chore) {
        household.lastMessage = 'I could not find that chore.';
        return household.lastMessage;
    }

    const occurrence = getChoreOccurrencesForChild(household, childId, date).find(item => item.choreId === choreId);
    if (!occurrence) {
        household.lastMessage = `${chore.title} is not due today.`;
        return household.lastMessage;
    }

    if (household.completions[occurrence.occurrenceId]) {
        household.lastMessage = `${child.name} already completed ${chore.title}.`;
        return household.lastMessage;
    }

    household.completions[occurrence.occurrenceId] = {
        occurrenceId: occurrence.occurrenceId,
        childId,
        choreId,
        date,
        completedAt: new Date().toISOString(),
        pointsAwarded: chore.pointValue || 0
    };

    addPointTransaction(household, child, {
        type: 'CHORE_COMPLETED',
        childId,
        choreId,
        occurrenceId: occurrence.occurrenceId,
        points: chore.pointValue || 0,
        reason: chore.title
    });

    household.lastMessage = `${child.name} earned ${chore.pointValue || 0} points for ${chore.title}.`;
    return household.lastMessage;
}

function awardBonus(household, childId, points, reason) {
    const child = getChild(household, childId);
    const normalizedPoints = Math.max(Number(points) || 0, 0);

    if (!child || normalizedPoints <= 0) {
        household.lastMessage = 'I could not award those bonus points.';
        return household.lastMessage;
    }

    addPointTransaction(household, child, {
        type: 'BONUS',
        childId,
        points: normalizedPoints,
        reason: reason || 'Bonus points'
    });

    household.lastMessage = `${child.name} earned ${normalizedPoints} bonus point${normalizedPoints === 1 ? '' : 's'}.`;
    return household.lastMessage;
}

function selectNextChild(household) {
    if (household.children.length === 0) {
        return;
    }

    const currentIndex = household.children.findIndex(child => child.childId === household.selectedChildId);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % household.children.length : 0;
    household.selectedChildId = household.children[nextIndex].childId;
    household.lastMessage = `Showing ${household.children[nextIndex].name}.`;
}

async function getAccessToken() {
    if (!ALEXA_CLIENT_ID || !ALEXA_CLIENT_SECRET) {
        console.log('Missing ALEXA_CLIENT_ID or ALEXA_CLIENT_SECRET. Skipping Data Store update.');
        return undefined;
    }

    const response = await axios({
        method: 'post',
        url: 'https://api.amazon.com/auth/o2/token',
        timeout: 3000,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            charset: 'utf-8'
        },
        params: {
            grant_type: 'client_credentials',
            client_id: ALEXA_CLIENT_ID,
            client_secret: ALEXA_CLIENT_SECRET,
            scope: 'alexa::datastore'
        }
    });

    return response.data;
}

async function updateDatastore(token, commands, target) {
    if (!token) {
        return;
    }

    const response = await axios({
        method: 'post',
        url: 'https://api.amazonalexa.com/v1/datastore/commands',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `${token.token_type} ${token.access_token}`
        },
        data: {
            commands,
            target
        }
    });

    console.log(`Data Store response: ${JSON.stringify(response.data)}`);
    return response.data;
}

async function pushWidgetData(handlerInput, household) {
    const widgetData = buildWidgetData(household);
    console.log(`Pushing widget data: ${JSON.stringify(widgetData)}`);

    const token = await getAccessToken();
    if (!token) {
        return {
            updated: false,
            reason: 'missingCredentials'
        };
    }

    const commands = [
        {
            type: 'PUT_OBJECT',
            namespace: DATASTORE_NAMESPACE,
            key: DATASTORE_KEY,
            content: widgetData
        }
    ];

    const target = {
        type: 'USER',
        id: handlerInput.requestEnvelope.context.System.user.userId
    };

    try {
        await updateDatastore(token, commands, target);
        return {
            updated: true
        };
    }
    catch (error) {
        console.log(`Data Store update failed: ${error.stack || JSON.stringify(error)}`);
        return {
            updated: false,
            reason: 'updateFailed'
        };
    }
}

async function saveAndPush(handlerInput, attributes, household) {
    const { attributesManager } = handlerInput;
    attributes.household = household;
    attributesManager.setPersistentAttributes(attributes);
    await attributesManager.savePersistentAttributes();
    return pushWidgetData(handlerInput, household);
}

function buildInlineStatusText(household, pushResult) {
    if (pushResult && pushResult.updated) {
        return household.lastMessage || 'Widget updated.';
    }

    if (pushResult && pushResult.reason === 'missingCredentials') {
        return `${household.lastMessage || 'Widget action received.'} Set Data Store credentials to sync.`;
    }

    if (pushResult && pushResult.reason === 'updateFailed') {
        return `${household.lastMessage || 'Widget action received.'} Sync failed; check logs.`;
    }

    return household.lastMessage || 'Widget action received.';
}

function addInlineWidgetStatusDirective(handlerInput, responseBuilder, household, pushResult) {
    const presentationUri = handlerInput.requestEnvelope.request.presentationUri;

    if (!presentationUri) {
        return responseBuilder;
    }

    return responseBuilder.addDirective({
        type: 'Alexa.Presentation.APL.ExecuteCommands',
        presentationUri,
        commands: [
            {
                type: 'SetValue',
                componentId: 'statusMessage',
                property: 'text',
                value: buildInlineStatusText(household, pushResult)
            }
        ]
    });
}

async function loadHousehold(handlerInput) {
    const { attributesManager } = handlerInput;
    const attributes = await attributesManager.getPersistentAttributes() || {};
    const household = ensureHousehold(attributes);
    return { attributes, household };
}

function getSlotValue(handlerInput, slotName) {
    const slots = handlerInput.requestEnvelope.request.intent.slots || {};
    return slots[slotName] && slots[slotName].value;
}

const InstallWidgetRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.DataStore.PackageManager.UsagesInstalled';
    },
    async handle(handlerInput) {
        const { attributes, household } = await loadHousehold(handlerInput);
        household.lastMessage = 'Widget installed. Tap a chore to earn points.';
        await saveAndPush(handlerInput, attributes, household);
        return handlerInput.responseBuilder.getResponse();
    }
};

const RemoveWidgetRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.DataStore.PackageManager.UsagesRemoved';
    },
    handle(handlerInput) {
        console.log(`Widget removed: ${JSON.stringify(handlerInput.requestEnvelope.request.payload)}`);
        return handlerInput.responseBuilder.getResponse();
    }
};

const UpdateWidgetRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.DataStore.PackageManager.UpdateRequest';
    },
    async handle(handlerInput) {
        const { attributes, household } = await loadHousehold(handlerInput);
        household.lastMessage = 'Widget updated.';
        await saveAndPush(handlerInput, attributes, household);
        return handlerInput.responseBuilder.getResponse();
    }
};

const WidgetInstallationErrorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.DataStore.PackageManager.InstallationError';
    },
    handle(handlerInput) {
        console.log(`Widget installation error: ${JSON.stringify(handlerInput.requestEnvelope.request.error)}`);
        return handlerInput.responseBuilder
            .speak('Sorry, there was an error installing the chore chart widget.')
            .getResponse();
    }
};

const APLEventHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'Alexa.Presentation.APL.UserEvent';
    },
    async handle(handlerInput) {
        const args = handlerInput.requestEnvelope.request.arguments || [];
        const eventType = args[0];

        if (eventType === 'openSkill') {
            return LaunchRequestHandler.handle(handlerInput);
        }

        const { attributes, household } = await loadHousehold(handlerInput);

        switch (eventType) {
            case 'completeChore': {
                const childId = args[1];
                const choreId = args[2];
                const date = args[3] || getTodayString();
                completeChore(household, childId, choreId, date);
                break;
            }
            case 'awardBonus': {
                const childId = args[1];
                const points = args[2] || 1;
                const reason = args[3] || 'Widget bonus';
                awardBonus(household, childId, points, reason);
                break;
            }
            case 'selectNextChild': {
                selectNextChild(household);
                break;
            }
            default: {
                household.lastMessage = 'Unknown widget action.';
                break;
            }
        }

        const pushResult = await saveAndPush(handlerInput, attributes, household);
        const responseBuilder = handlerInput.responseBuilder
            .withShouldEndSession(true);

        addInlineWidgetStatusDirective(handlerInput, responseBuilder, household, pushResult);
        return responseBuilder.getResponse();
    }
};

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    async handle(handlerInput) {
        const { attributes, household } = await loadHousehold(handlerInput);
        const selectedChild = getSelectedChild(household);
        const chores = getChoreOccurrencesForChild(household, selectedChild.childId, getTodayString());
        const remaining = chores.filter(chore => !chore.completed).length;
        await saveAndPush(handlerInput, attributes, household);

        const speakOutput = `${selectedChild.name} has ${selectedChild.currentPoints} points and ${remaining} chores left today. You can use the widget to complete chores or add bonus points.`;
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt('You can ask for chore status or give bonus points.')
            .getResponse();
    }
};

const ChoreStatusIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'ChoreStatusIntent';
    },
    async handle(handlerInput) {
        const { attributes, household } = await loadHousehold(handlerInput);
        const selectedChild = getSelectedChild(household);
        const chores = getChoreOccurrencesForChild(household, selectedChild.childId, getTodayString());
        const remaining = chores.filter(chore => !chore.completed);
        await saveAndPush(handlerInput, attributes, household);

        const speakOutput = remaining.length === 0
            ? `${selectedChild.name} has finished all chores today and has ${selectedChild.currentPoints} points.`
            : `${selectedChild.name} has ${selectedChild.currentPoints} points. Chores left today are ${remaining.map(chore => chore.title).join(', ')}.`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};

const GiveBonusPointsIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'GiveBonusPointsIntent';
    },
    async handle(handlerInput) {
        const { attributes, household } = await loadHousehold(handlerInput);
        const kidName = getSlotValue(handlerInput, 'kidName');
        const pointsValue = getSlotValue(handlerInput, 'points');
        const child = findChildByName(household, kidName) || getSelectedChild(household);
        const points = Math.max(Number(pointsValue) || 0, 0);

        if (points <= 0) {
            return handlerInput.responseBuilder
                .speak('How many points should I add?')
                .reprompt('Try saying, give Emma five points.')
                .getResponse();
        }

        awardBonus(household, child.childId, points, 'bonus points');
        await saveAndPush(handlerInput, attributes, household);

        return handlerInput.responseBuilder
            .speak(`${child.name} earned ${points} bonus point${points === 1 ? '' : 's'}.`)
            .getResponse();
    }
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'This chore chart tracks chores, points, and rewards for multiple kids. Use the widget to complete chores, or say give Emma five points.';
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        return handlerInput.responseBuilder
            .speak('Goodbye!')
            .getResponse();
    }
};

const FallbackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
        return handlerInput.responseBuilder
            .speak('Sorry, I did not understand that. Try asking for chore status.')
            .reprompt('Try asking for chore status.')
            .getResponse();
    }
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`Session ended: ${JSON.stringify(handlerInput.requestEnvelope)}`);
        return handlerInput.responseBuilder.getResponse();
    }
};

const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
        return handlerInput.responseBuilder
            .speak(`You triggered ${intentName}.`)
            .getResponse();
    }
};

const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`Error handled: ${error.stack || JSON.stringify(error)}`);
        return handlerInput.responseBuilder
            .speak('Sorry, I had trouble with the chore chart. Please try again.')
            .reprompt('Please try again.')
            .getResponse();
    }
};

const LoggingRequestInterceptor = {
    process(handlerInput) {
        console.log(`Incoming request: ${JSON.stringify(handlerInput.requestEnvelope)}`);
    }
};

exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        InstallWidgetRequestHandler,
        RemoveWidgetRequestHandler,
        UpdateWidgetRequestHandler,
        WidgetInstallationErrorHandler,
        APLEventHandler,
        LaunchRequestHandler,
        ChoreStatusIntentHandler,
        GiveBonusPointsIntentHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        FallbackIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler)
    .addErrorHandlers(ErrorHandler)
    .addRequestInterceptors(LoggingRequestInterceptor)
    .withCustomUserAgent('kids-chore-widget/prototype-0.1')
    .withPersistenceAdapter(
        new ddbAdapter.DynamoDbPersistenceAdapter({
            tableName: process.env.DYNAMODB_PERSISTENCE_TABLE_NAME,
            createTable: false,
            dynamoDBClient: new AWS.DynamoDB({
                apiVersion: 'latest',
                region: process.env.DYNAMODB_PERSISTENCE_REGION || process.env.AWS_REGION
            })
        })
    )
    .lambda();
