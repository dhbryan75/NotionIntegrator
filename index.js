const Dotenv = require("dotenv");
const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const { Client } = require("@notionhq/client");
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');

// DB > MetaDB > Single DB > DoNotErase > Tasks > Single Task

const msPerSec = 1000;
const secPerMin = 60;
const minPerHour = 60;
const hourPerDay = 24;
const refreshIntervalMs = msPerSec * secPerMin * 5;
// const refreshIntervalMs = msPerSec * secPerMin * minPerHour * 10;
// const refreshIntervalMs = msPerSec * secPerMin * minPerHour * hourPerDay * 7 * 10000;
const pageSize = 50;


// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

const delay = async function(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
};

const dateToStringTime = function(date) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
};

const dateToStringDate = function(date) {
    return `${date.getFullYear().toString().padStart(4, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
}

const dateToStringMin = function(date) {
    return dateToStringDate(date) + " " + dateToStringTime(date);
};

const strToDate = (dateStr) => {
	if (!dateStr) {
		return null;
	}
	const [datePart, timePart] = dateStr.split("T");
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

const insertEvent = async(auth, taskPageId, databaseName, taskProjectNamesStr, taskTitle, taskStartDate, taskEndDate, taskPersonNamesStr) => {
	const nowStr = dateToStringMin(new Date());
	const eventTitle = `[${databaseName}${taskProjectNamesStr ? "/" : ""}${taskProjectNamesStr}] ${taskTitle}`;
	const eventDescription = `담당자: ${taskPersonNamesStr}, NotionPageId: ${taskPageId}`;
	if(!taskStartDate) {
		console.log(`${nowStr}: ${eventTitle} (No Date)`);
		return;
	}

	taskEndDate = taskEndDate ? taskEndDate : taskStartDate;
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
	};
	const calendar = google.calendar({version: 'v3', auth});

	const searchStartDate = new Date(taskStartDate.getTime() - msPerSec * secPerMin * minPerHour * hourPerDay);
	const searchEndDate = new Date(taskEndDate.getTime() + msPerSec * secPerMin * minPerHour * hourPerDay);
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
	const auth = await authorize();
	const nowMs = Date.now();
	const nowMinuteMs = nowMs - (nowMs % (msPerSec * secPerMin));
	const lastUpdateMs = nowMinuteMs - refreshIntervalMs;

	Dotenv.config();
	const notion = new Client({
		auth: process.env.NOTION_TOKEN,
	});

	const metaDatabaseId = process.env.META_DATABASE_ID;
	const databasePages = (await notion.databases.query({
		database_id: metaDatabaseId,
		page_size: pageSize,
	})).results;

	for(let databasePage of databasePages) {
		const databaseName = databasePage.properties["이름"].title[0]?.plain_text;
		const databaseBlocks = (await notion.blocks.children.list({
			block_id: databasePage.id,
			page_size: pageSize,
		})).results;

		const callout = databaseBlocks.findLast((block) => {
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

		const DoNotErasePage = toggleBlocks.find((block) => {
			return block.type === "child_page";
		})
		const DoNotErasePageBlocks = (await notion.blocks.children.list({
			block_id: DoNotErasePage.id,
			page_size: pageSize,
		})).results;

		const TasksDatabase = DoNotErasePageBlocks.find((block) => {
			if (block.type === "child_database") {
				return block.child_database.title === "Tasks";
			}
			return false;
		});

		const recentFilter = {
			"and": [
				{
					"timestamp": "last_edited_time",
					"last_edited_time": {
						"on_or_after": new Date(lastUpdateMs).toISOString().split(".")[0],
					}
				},
				{
					"timestamp": "last_edited_time",
					"last_edited_time": {
						"before": new Date(nowMinuteMs).toISOString().split(".")[0],
					}
				},
			],
		};

		let hasMore = true;
		let nextCursor;
		let taskPages = [];
		while (hasMore) {
			const taskPageResponse = await notion.databases.query({
				database_id: TasksDatabase.id,
				filter: recentFilter,
				page_size: pageSize,
				start_cursor: nextCursor,
			});
			taskPages.push(...taskPageResponse.results);
			hasMore = taskPageResponse.has_more;
			if (hasMore) {
				nextCursor = taskPageResponse.next_cursor;
			}
		}
		for(let taskPage of taskPages) {
			const taskPageId =  taskPage.id;
			const taskTitle = taskPage.properties["제목"].title[0]?.plain_text;
			const taskStartDate = strToDate(taskPage.properties["날짜"].date?.start);
			const taskEndDate = strToDate(taskPage.properties["날짜"].date?.end);
			// const taskStatus = taskPage.properties["상태"].status?.name;

			const taskProjectPages = taskPage.properties["Projects"].relation;
			const taskProjectNamePromises = taskProjectPages.map(async (page) => {
				const pageResponse = await notion.pages.retrieve({ page_id: page.id });
				return pageResponse.properties["제목"].title[0]?.plain_text;
			});
			const taskProjectNames = await Promise.all(taskProjectNamePromises);
			const taskProjectNamesStr = taskProjectNames.join(", ");

			const taskPersonPages = taskPage.properties["담당자"].relation;
			const taskPersonNamePromises = taskPersonPages.map(async (page) => {
				const pageResponse = await notion.pages.retrieve({ page_id: page.id });
				return pageResponse.properties["이름"].title[0]?.plain_text;
			});
			const taskPersonNames = await Promise.all(taskPersonNamePromises);
			const taskPersonNamesStr = taskPersonNames.join(", ");

			await insertEvent(auth, taskPageId, databaseName, taskProjectNamesStr, taskTitle, taskStartDate, taskEndDate, taskPersonNamesStr);
		}
	}
};

const main = async () => {
	try {
		await refresh();
	} catch (error) {
		console.log(error);
	}
}

main();