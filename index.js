"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const Dotenv = require("dotenv");
const fs = require('fs').promises;
const path = require('path');
const Process = require('process');
const { Client } = require("@notionhq/client");
const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');
const msPerSec = 1000;
const secPerMin = 60;
const minPerHour = 60;
const hourPerDay = 24;
const msPerDay = msPerSec * secPerMin * minPerHour * hourPerDay;
// const refreshIntervalMs = msPerSec * secPerMin * 5;
const refreshIntervalMs = msPerSec * secPerMin * minPerHour * 10;
// const refreshIntervalMs = msPerDay * 7 * 10000;
const pageSize = 50;
// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(Process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(Process.cwd(), 'credentials.json');
const delay = function (ms) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise(resolve => setTimeout(resolve, ms));
    });
};
const dateToTimeString = function (date) {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
};
const dateToDateString = function (date) {
    return `${date.getFullYear().toString().padStart(4, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
};
const dateToDateTimeString = function (date) {
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
function loadSavedCredentialsIfExist() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const content = yield fs.readFile(TOKEN_PATH);
            const credentials = JSON.parse(content);
            return google.auth.fromJSON(credentials);
        }
        catch (err) {
            return null;
        }
    });
}
;
/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
function saveCredentials(client) {
    return __awaiter(this, void 0, void 0, function* () {
        const content = yield fs.readFile(CREDENTIALS_PATH);
        const keys = JSON.parse(content);
        const key = keys.installed || keys.web;
        const payload = JSON.stringify({
            type: 'authorized_user',
            client_id: key.client_id,
            client_secret: key.client_secret,
            refresh_token: client.credentials.refresh_token,
        });
        yield fs.writeFile(TOKEN_PATH, payload);
    });
}
;
/**
 * Load or request or authorization to call APIs.
 *
 */
function authorize() {
    return __awaiter(this, void 0, void 0, function* () {
        let client = yield loadSavedCredentialsIfExist();
        if (client) {
            return client;
        }
        client = yield authenticate({
            scopes: SCOPES,
            keyfilePath: CREDENTIALS_PATH,
        });
        if (client.credentials) {
            yield saveCredentials(client);
        }
        return client;
    });
}
;
const insertEvent = (auth, databaseId, taskPageId, taskUrl, databaseName, taskProjectNamesString, taskTitle, taskStatus, taskStartDate, taskEndDate, taskPersonNamesString) => __awaiter(void 0, void 0, void 0, function* () {
    const nowStr = dateToDateTimeString(new Date());
    const eventTitle = taskTitle;
    const eventDescription = `[${databaseName}/${taskProjectNamesString}] Responsibility: ${taskPersonNamesString} / Status: ${taskStatus} / UpdatedAt: ${nowStr} / NotionDatabaseId: ${databaseId} / NotionPageId: ${taskPageId} / NotionPageUrl: ${taskUrl}`;
    if (!taskStartDate) {
        console.log(`${nowStr}: ${eventTitle} (No Date)`);
        return;
    }
    if (taskEndDate) {
        if (taskEndDate.getHours() === 0 && taskEndDate.getMinutes() === 0) {
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
            "useDefault": false,
            "overrides": [],
        },
    };
    const calendar = google.calendar({ version: 'v3', auth });
    const searchStartDate = new Date(taskStartDate.getTime() - 3 * msPerDay);
    const searchEndDate = new Date(taskEndDate.getTime() + 3 * msPerDay);
    const searchResult = yield calendar.events.list({
        auth: auth,
        calendarId: 'primary',
        timeMax: searchEndDate.toISOString(),
        timeMin: searchStartDate.toISOString(),
    });
    const sameEvents = searchResult.data.items.filter((event) => {
        var _a;
        return (_a = event.description) === null || _a === void 0 ? void 0 : _a.includes(taskPageId);
    });
    for (let event of sameEvents) {
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
});
const refresh = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    const auth = yield authorize();
    const nowMs = Date.now();
    const nowMinuteMs = nowMs - (nowMs % (msPerSec * secPerMin));
    const lastUpdateMs = nowMinuteMs - refreshIntervalMs;
    console.log(`Refresh Started At: ${dateToDateTimeString(new Date(nowMs))}`);
    Dotenv.config();
    const notion = new Client({
        auth: process.env.NOTION_TOKEN,
    });
    const metaDatabaseId = process.env.META_DATABASE_ID;
    const databasePages = (yield notion.databases.query({
        database_id: metaDatabaseId,
        page_size: pageSize,
    })).results;
    for (const databasePage of databasePages) {
        const databaseName = (_a = databasePage.properties["이름"].title[0]) === null || _a === void 0 ? void 0 : _a.plain_text;
        const databaseId = databasePage.id;
        const databaseBlocks = (yield notion.blocks.children.list({
            block_id: databaseId,
            page_size: pageSize,
        })).results;
        const callout = databaseBlocks.reverse().find((block) => {
            return block.type === "callout";
        });
        const callOutBlocks = (yield notion.blocks.children.list({
            block_id: callout.id,
            page_size: pageSize,
        })).results;
        const toggle = callOutBlocks.find((block) => {
            return block.type === "toggle";
        });
        const toggleBlocks = (yield notion.blocks.children.list({
            block_id: toggle.id,
            page_size: pageSize,
        })).results;
        const DoNotErasePage = toggleBlocks.find((block) => {
            return block.type === "child_page";
        });
        const DoNotErasePageBlocks = (yield notion.blocks.children.list({
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
            const taskPagesResponse = yield notion.databases.query({
                database_id: TasksDatabase.id,
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
        for (const taskPage of taskPages) {
            const taskPageId = taskPage.id;
            const taskUrl = taskPage.url;
            const taskTitle = (_b = taskPage.properties["제목"].title[0]) === null || _b === void 0 ? void 0 : _b.plain_text;
            const taskStartDate = stringToDate((_c = taskPage.properties["날짜"].date) === null || _c === void 0 ? void 0 : _c.start);
            const taskEndDate = stringToDate((_d = taskPage.properties["날짜"].date) === null || _d === void 0 ? void 0 : _d.end);
            const taskStatus = (_e = taskPage.properties["상태"].status) === null || _e === void 0 ? void 0 : _e.name;
            const taskProjectPages = taskPage.properties["Projects"].relation;
            const taskProjectNamePromises = taskProjectPages.map((page) => __awaiter(void 0, void 0, void 0, function* () {
                var _f;
                const pageResponse = yield notion.pages.retrieve({ page_id: page.id });
                return (_f = pageResponse.properties["제목"].title[0]) === null || _f === void 0 ? void 0 : _f.plain_text;
            }));
            const taskProjectNames = yield Promise.all(taskProjectNamePromises);
            const taskProjectNamesString = taskProjectNames.join(", ");
            const taskPersonPages = taskPage.properties["담당자"].relation;
            const taskPersonNamePromises = taskPersonPages.map((page) => __awaiter(void 0, void 0, void 0, function* () {
                var _g;
                const pageResponse = yield notion.pages.retrieve({ page_id: page.id });
                return (_g = pageResponse.properties["이름"].title[0]) === null || _g === void 0 ? void 0 : _g.plain_text;
            }));
            const taskPersonNames = yield Promise.all(taskPersonNamePromises);
            const taskPersonNamesString = taskPersonNames.join(", ");
            yield insertEvent(auth, databaseId, taskPageId, taskUrl, databaseName, taskProjectNamesString, taskTitle, taskStatus, taskStartDate, taskEndDate, taskPersonNamesString);
        }
    }
});
const main = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield refresh();
    }
    catch (error) {
        console.log(error);
    }
});
main();
