const Dotenv = require("dotenv");
const fs = require('fs').promises;
const path = require('path');
const Process = require('process');
const { Client } = require("@notionhq/client");
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');

Dotenv.config();

// DB > MetaDB > DB > Tasks > Task

const msPerSec = 1000;
const secPerMin = 60;
const minPerHour = 60;
const hourPerDay = 24;
const msPerDay = msPerSec * secPerMin * minPerHour * hourPerDay;
const refreshIntervalMs = msPerSec * secPerMin * parseInt(process.env.REFRESH_INTERVAL_MINUTE || "5");
// const refreshIntervalMs = msPerSec * secPerMin * minPerHour * 10;
// const refreshIntervalMs = msPerDay * 7;
// const refreshIntervalMs = msPerDay * 7 * 10000;
const pageSize = 50;


// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(Process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(Process.cwd(), 'credentials.json');

const delay = async function(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
};

const dateToTimeString = function(date) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
};

const dateToDateString = function(date) {
    return `${date.getFullYear().toString().padStart(4, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
}

const dateToDateTimeString = function(date) {
    return `${dateToDateString(date)} ${dateToTimeString(date)}`;
};

const stringToDate = (dateString) => {
	if (!dateString) {
		return null;
	}
	const [datePart, timePart] = dateString.split("T");
	const [year, month, day] = datePart.split("-").map((elem) => parseInt(elem));
	const monthIndex = month - 1;
	if (!timePart) {
		return new Date(year, monthIndex, day);
	}
	else {
		const [hour, minute, second] = timePart.split(":").map((elem) => parseInt(elem));
		return new Date(year, monthIndex, day, hour, minute, second);
	}
};

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
	try {
		const content = await fs.readFile(TOKEN_PATH);
		const credentials = JSON.parse(content);
		return google.auth.fromJSON(credentials);
	} catch (err) {
		return null;
	}
};

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
	const content = await fs.readFile(CREDENTIALS_PATH);
	const keys = JSON.parse(content);
	const key = keys.installed || keys.web;
	const payload = JSON.stringify({
		type: 'authorized_user',
		client_id: key.client_id,
		client_secret: key.client_secret,
		refresh_token: client.credentials.refresh_token,
	});
	await fs.writeFile(TOKEN_PATH, payload);
};

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
	let client = await loadSavedCredentialsIfExist();
	if (client) {
		return client;
	}
	client = await authenticate({
		scopes: SCOPES,
		keyfilePath: CREDENTIALS_PATH,
	});
	if (client.credentials) {
		await saveCredentials(client);
	}
	return client;
};

const insertEvent = async(auth, databaseId, taskPageId, taskUrl, databaseName, taskProjectNamesString, taskTitle, taskStatus, taskStartDate, taskEndDate, taskPersonNamesString) => {
	const nowStr = dateToDateTimeString(new Date());
	const eventTitle = taskTitle;
	const eventDescription = `[${databaseName}/${taskProjectNamesString}] Responsibility: ${taskPersonNamesString} / Status: ${taskStatus} / UpdatedAt: ${nowStr} / NotionDatabaseId: ${databaseId} / NotionPageId: ${taskPageId} / NotionPageUrl: ${taskUrl}`;
	if(!taskStartDate) {
		console.log(`${nowStr}: ${eventTitle} (No Date)`);
		return;
	}

	if(taskEndDate) {
		if(taskEndDate.getHours() === 0 && taskEndDate.getMinutes() === 0) {
			taskEndDate = new Date(taskEndDate.getTime() + msPerDay);
		}
	}
	else {
		taskEndDate = taskStartDate;
	}
	const eventStart = {
		'dateTime': taskStartDate.toISOString(),
		'timeZone': 'Asia/Seoul',
	};
	const eventEnd = {
		'dateTime': taskEndDate.toISOString(),
		'timeZone': 'Asia/Seoul',
	};
	let event = {
		'summary': eventTitle,
		'description': eventDescription,
		'start': eventStart,
		'end': eventEnd,
		"reminders": {
			"useDefault":false,
			"overrides":[],
		},
	};
	const calendar = google.calendar({version: 'v3', auth});

	const searchStartDate = new Date(taskStartDate.getTime() - 14 * msPerDay);
	const searchEndDate = new Date(taskEndDate.getTime() + 14 * msPerDay);
	const searchResult = await calendar.events.list({
		auth: auth,
		calendarId: 'primary',
		timeMax: searchEndDate.toISOString(),
		timeMin: searchStartDate.toISOString(),
	});
	const sameEvents = searchResult.data.items.filter((event) => {
		return event.description?.includes(taskPageId);
	});
	for(let event of sameEvents) {
		const eventId = event.id;
		calendar.events.delete({
			auth: auth,
			calendarId: 'primary',
			eventId: eventId,
		}), function (error, event) {
			if (error) {
				console.log(eventTitle);
				return;
			}
		};
	}

	calendar.events.insert({
		auth: auth,
		calendarId: 'primary',
		resource: event,
	}, function (error, event) {
		if (error) {
			console.log(eventTitle);
			return;
		}
		console.log(`${nowStr}: ${eventTitle}`);
	});
};

const refresh = async() => {
	try {
		const auth = await authorize();
		const nowMs = Date.now();
		const nowMinuteMs = nowMs - (nowMs % (msPerSec * secPerMin));
		const lastUpdateMs = nowMinuteMs - refreshIntervalMs;
		// console.log(`Refresh Started At: ${dateToDateTimeString(new Date(nowMs))}`);

		const notion = new Client({
			auth: process.env.NOTION_TOKEN,
		});

		const metaDatabaseId = process.env.META_DATABASE_ID;
		const databasePages = (await notion.databases.query({
			database_id: metaDatabaseId,
			page_size: pageSize,
		})).results;

		for(const databasePage of databasePages) {		
			if(!databasePage.properties["캘린더 연동"].checkbox) {
				continue;
			}
			const databaseName = databasePage.properties["이름"].title[0]?.plain_text;
			const databaseId = databasePage.id;
			const databaseBlocks = (await notion.blocks.children.list({
				block_id: databaseId,
				page_size: pageSize,
			})).results;

			const callout = databaseBlocks.reverse().find((block) => {
				return block.type === "callout";
			});
			const callOutBlocks = (await notion.blocks.children.list({
				block_id: callout.id,
				page_size: pageSize,
			})).results;

			const toggle = callOutBlocks.find((block) => {
				return block.type === "toggle";
			})
			const toggleBlocks = (await notion.blocks.children.list({
				block_id: toggle.id,
				page_size: pageSize,
			})).results;

			const tasksDatabase = toggleBlocks.find((block) => {
				if (block.type === "child_database") {
					return block.child_database.title === "Tasks";
				}
				return false;
			});
			if(!tasksDatabase) {
				continue;
			}

			const recentFilter = {
				"timestamp": "last_edited_time",
				"last_edited_time": {
					"on_or_after": new Date(lastUpdateMs).toISOString().split(".")[0],
				}
			};

			let hasMore = true;
			let nextCursor;
			let taskPages = [];
			while (hasMore) {
				const taskPagesResponse = await notion.databases.query({
					database_id: tasksDatabase.id,
					filter: recentFilter,
					page_size: pageSize,
					start_cursor: nextCursor,
				});
				taskPages.push(...taskPagesResponse.results);
				hasMore = taskPagesResponse.has_more;
				if (hasMore) {
					nextCursor = taskPagesResponse.next_cursor;
				}
			}
			for(const taskPage of taskPages) {
				const taskPageId =  taskPage.id;
				const taskUrl = taskPage.url;
				const taskTitle = taskPage.properties["제목"].title[0]?.plain_text;
				const taskStartDate = stringToDate(taskPage.properties["날짜"].date?.start);
				const taskEndDate = stringToDate(taskPage.properties["날짜"].date?.end);
				const taskStatus = taskPage.properties["상태"].status?.name;

				const taskProjectPages = taskPage.properties["Projects"].relation;
				const taskProjectNamePromises = taskProjectPages.map(async (page) => {
					const pageResponse = await notion.pages.retrieve({ page_id: page.id });
					return pageResponse.properties["제목"].title[0]?.plain_text;
				});
				const taskProjectNames = await Promise.all(taskProjectNamePromises);
				const taskProjectNamesString = taskProjectNames.join(", ");

				const taskPersonPages = taskPage.properties["담당자"].relation;
				const taskPersonNamePromises = taskPersonPages.map(async (page) => {
					const pageResponse = await notion.pages.retrieve({ page_id: page.id });
					return pageResponse.properties["이름"].title[0]?.plain_text;
				});
				const taskPersonNames = await Promise.all(taskPersonNamePromises);
				const taskPersonNamesString = taskPersonNames.join(", ");

				await insertEvent(auth, databaseId, taskPageId, taskUrl, databaseName, taskProjectNamesString, taskTitle, taskStatus, taskStartDate, taskEndDate, taskPersonNamesString);
			}
		}
	} catch (error) {
		console.log(error);
	}
	finally {
		process.exit();
	}
};

refresh();