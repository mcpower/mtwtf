const fs = require("fs");
const menubar = require('menubar');
const path = require('path');
const electron = require("electron");
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

var savedCreds = {remember: false};

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
					groups.push({
						subject: subject,
						group: group
					});
					break;
				default:
					break;
			}
		}
	}
}

function getActivities() {
	for (var i = 0; i < groups.length; i++) {
		request(api_url + data.student.student_code + "/subject/" + groups[i].subject + "/group/" + groups[i].group + "/activities/", function (_, _, activities) {
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

			all_acts[first_split[0] + "|" + first_split[1]] = listify(g);
			if (Object.keys(all_acts).length == groups.length) {
				console.log(all_acts);
			}
		});
	}
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
	request.post({url: api_url + "login", form: {username: username, password: password}}, function (_, _, login){
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
			request(homepage_url, function (_, _, homepage){
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

var mb = menubar({
	skipTaskbar: true,
	width: 400,
	height: 500,
	index: "file://" + path.join(app.getAppPath(), 'login.html')
});

mb.on('ready', function() {
	var menu = Menu.buildFromTemplate([
		{label: "Exit", click: function () {app.quit()}}
	]);
	mb.tray.setContextMenu(menu);
	mb.showWindow();
});
