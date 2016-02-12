const fs = require("fs");
const menubar = require('menubar');
const path = require('path');
const electron = require("electron");
const _ = require("lodash");
const Menu = electron.Menu;
const MenuItem = electron.MenuItem;
const app = electron.app;
const ipcMain = electron.ipcMain;
const api_url = "https://allocate.timetable.monash.edu/aplus-2016/rest/student/";
const homepage_url = "https://allocate.timetable.monash.edu/aplus-2016/student/";
const cred_store_file = "savedcreds.json";
var request = require("request").defaults({jar: true});
var data;
var groups = [];
var all_acts = {};
var unique_times = {};
var group_len = [];
var perms = []

var savedCreds = {remember: false};

var mb = menubar({
	skipTaskbar: true,
	width: 400,
	height: 500,
	index: "file://" + path.join(app.getAppPath(), 'login.html')
});

function encode64(s) {
	return new Buffer(s).toString("base64");
}

function decode64(s) {
	return new Buffer(s, "base64").toString("ascii");
}

fs.stat(cred_store_file, function (err, stats) {
	if (!err && stats.isFile()) {
		savedCreds = JSON.parse(fs.readFileSync(cred_store_file));
		savedCreds.password = decode64(savedCreds.password);
	}
});

function compareMultipleReverse(a, b) {
	// given two arrays of ints, maximise first, then second, etc.
	for (var i = 0; i < a.length; i++) {
		var result = b[i] - a[i];
		if (result) {
			return result;
		}
	}
	return 0;
}

function sortWithKey(arr, key, key_cmp) {
	var mapped = arr.map(function (el, i) {
		return {index: i, value: key(el)};
	});

	mapped.sort(key_cmp);

	return result.map(function (el) {
		return arr[el.index];
	});
}

function over(arr) {
	// list of functions which take one value -> function which takes one value
	return function(x) {
		return arr.map(function(f) {
			return f(x);
		});
	};
}

function createTimetable(perm) {
	var timetable = new Array(5);
	for (var day = 0; day < 5; day++) {
		timetable[day] = new Array(24);
	}
	for (var i = 0; i < perm.length; i++) {
		var group = groups[i];
		var activity = unique_times[group][perm[i]];
		for (var i = 0; i < activity.duration; i++) {
			timetable[activity.day][activity.time + i] = group;
		}
	}
	var startends = []; // array of objects with .start, .end properties
	var breaks = []; // array of numbers
	for (var day = 0; day < 5; day++) {
		var start = -1;
		var end = -1;
		var cur_break = 0;
		for (var block = 0; block < 24; block++) {
			// undefined is falsy
			if (timetable[day][block]) {
				if (start === -1) {
					start = block;
				}
				end = block;
				if (cur_break) {
					breaks.push(cur_break);
					cur_break = 0;
				}
			} else {
				if (start !== -1) {
					cur_break++;
				}
			}
		}
		if ((start !== -1) && (end !== -1)) {
			startends.push({
				start: start,
				end: end
			});
		}
	}

	return {
		timetable: timetable,
		startends: startends,
		breaks: breaks
	};
}

function extractGroups() {
	groups = [];
	var subjects = data.student.student_enrolment;
	for (var subject in subjects) {
		if (!subjects.hasOwnProperty(subject)) {continue;}

		var groups_data = subjects[subject].groups;
		for (var group in groups_data) {
			if (!groups_data.hasOwnProperty(group)) {continue;}

			switch (groups_data[group].status) {
				case "PREFERENCE ENTRY BY ACTIVITY":
				case "PREFERENCE ENTRY BY START TIME":
					groups.push(subject + "|" + group);
					break;
				default:
					break;
			}
		}
	}
	groups.sort();
}

function getActivities() {
	for (var i = 0; i < groups.length; i++) {
		var split = groups[i].split("|");
		request(api_url + data.student.student_code + "/subject/" + split[0] + "/group/" + split[1] + "/activities/", function (error, response, activities) {
			var activities = JSON.parse(activities);
			var keys = Object.keys(activities);
			var first_split = keys[0].split("|"); // subject, group, act_code
			var g = {}; // {key: {repeat: {part: json}}}, eventually becomes {key: [[json, json], [json]]}
			for (var i = 0; i < keys.length; i++) {
				var act_code = keys[i].split("|")[2].split("-")
				var repeat = Number(act_code[0])
				if (!g.hasOwnProperty(repeat)) {
					g[repeat] = {};
				}
				var part;
				if (act_code.length == 2) {
					part = Number(act_code[1].substr(1));
				} else {
					part = 1;
				}

				g[repeat][part] = activities[keys[i]];
			}

			var repeats = Object.keys(g);
			for (var i = 0; i < repeats.length; i++) {
				g[repeats[i]] = listify(g[repeats[i]]);
			}

			var activity_key = first_split[0] + "|" + first_split[1];
			all_acts[activity_key] = listify(g);
			var times = _.uniqWith(all_acts[activity_key].map(function (repeat) {
				return _.sortBy(repeat.map(createBlockObj), ["day", "time", "duration"]);
			}), _.isEqual);
			unique_times[activity_key] = times;
			group_len[groups.indexOf(activity_key)] = times.length;
			if (Object.keys(unique_times).length === groups.length) {
				activitiesRetrieved();
			}
		});
	}
}

function time(timeString) {
	var out = -16;
	timeString = timeString.toLowerCase().trim();
	var hour = Number(timeString.split(":")[0]);
	if (timeString.endsWith("am")) {
		if (hour < 8) {
			console.log("Time is before 8am");
			return;
		}
		timeString = timeString.slice(0, -2).trim();
	} else if (timeString.endsWith("pm")) {
		if (hour >= 8 && hour != 12) {
			console.log("Time exceeds 8pm");
			return;
		}
		timeString = timeString.slice(0, -2).trim();
		if (!timeString.startsWith("12")) {
			out += 24;
		}
	} else {
		if (hour < 8) {
			out += 24;
		}
	}

	var timeSplit = timeString.split(":").map(Number);

	if (timeSplit.length > 2) {
		console.log("More than 2 colons found in time");
		return;
	}

	if (timeSplit.length == 2) {
		switch (timeSplit[1]) {
			case 30:
				out++;
				break;
			case 0:
				break;
			default:
				console.log("Minutes is not 00 or 30");
				return
		}
	}

	out += timeSplit[0] * 2;

	return out;
}

function activitiesRetrieved() {
	perms = getPermutations();
	mb.window.webContents.send("receive-num-noclashperms", perms.length);
}

function getAllPerms(arr) {
	if (arr.length === 0) {
		return [[]];
	}
	var out = [];
	var next = getAllPerms(arr.slice(1));
	for (var i = 0; i < arr[0]; i++) {
		for (var j = 0; j < next.length; j++) {
			out.push([i].concat(next[j]));
		}
	}
	return out;
}

function getPermutations() {
	var allPerms = getAllPerms(group_len);
	var out = [];
	loop1:
	for (var i = 0; i < allPerms.length; i++) {
		var perm = allPerms[i];
		var activities_per_day = new Array(5);
		for (var j1 = 0; j1 < 5; j1++) {
			activities_per_day[j1] = [];
		}
		for (var j2 = 0; j2 < perm.length; j2++) {
			unique_times[groups[j2]][perm[j2]].forEach(function (block) {
				activities_per_day[block.day].push(block);
			});
		}

		for (var j3 = 0; j3 < 5; j3++) {
			var day = activities_per_day[j3];
			day.sort(function (a, b) {
				return a.time - b.time;
			});
			for (var k = 1; k < day.length; k++) {
				if ((day[k].time) < (day[k-1].time + day[k-1].duration)) {
					continue loop1;
				}
			}
		}
		out.push(perm);
	}
	return out;
}

function createBlockObj(json) {
	var day = 0;
	switch (json.day_of_week) {
		case "Mon":
			day = 0;
			break;
		case "Tue":
			day = 1;
			break;
		case "Wed":
			day = 2;
			break;
		case "Thu":
			day = 3;
			break;
		case "Fri":
			day = 4;
			break;
		default:
			console.log("wat");
	}
	var time = 0;
	var hm = json.start_time.split(":").map(Number);
	if (hm[1] === 0) {
		time = 2 * (hm[0] - 8);
	} else if (hm[1] === 30) {
		time = 2 * (hm[0] - 8) + 1;
	} else {
		console.log("Time isn't multiple of 30?")
	}
	var duration = Number(json.duration) / 30;
	return {
		day: day,
		time: time,
		duration: duration
	};
}

function listify(obj) {
	var out = [];
	var keys = Object.keys(obj).sort();
	for (var i = 0; i < keys.length; i++) {
		out.push(obj[keys[i]]);
	}
	return out;
}

ipcMain.on("async-login", function(event, username, password, remember) {
	request.post({url: api_url + "login", form: {username: username, password: password}}, function (error, response, login){
		var login = JSON.parse(login);
		if (!login.success) {
			event.sender.send("login-reply", false);
		} else {
			if (remember) {
				savedCreds = {
					username: username,
					password: password,
					remember: remember
				};

				to_write_creds = new Object(savedCreds);
				to_write_creds.password = encode64(to_write_creds.password);
				fs.writeFileSync(cred_store_file, JSON.stringify(to_write_creds));
			} else {
				fs.stat(cred_store_file, function (err, stats) {
					if (!err && stats.isFile()) {
						fs.unlinkSync(cred_store_file);
					}
				});
			}
			request = request.defaults({qs: {ss: login.token}});
			request(homepage_url, function (error, response, homepage){
				data = JSON.parse(homepage.match(/^data=([^;]+);$/m)[1]);
				extractGroups();
				getActivities();
				event.sender.send("login-reply", true);
			});
		}
	});
});

ipcMain.on("async-get-data", function (event) {
	event.sender.send("get-data-reply", data);
});

ipcMain.on("async-get-savedcreds", function (event) {
	event.sender.send("get-savedcreds-reply", savedCreds);
});

mb.on('ready', function() {
	var menu = Menu.buildFromTemplate([
		{label: "Exit", click: function () {app.quit()}}
	]);
	mb.tray.setContextMenu(menu);
	mb.showWindow();
});
