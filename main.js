const fs = require("fs");
const menubar = require('menubar');
const path = require('path');
const electron = require("electron");
const Menu = electron.Menu;
const MenuItem = electron.MenuItem;
const app = electron.app;
const ipcMain = electron.ipcMain;
const api_url = "https://allocate.timetable.monash.edu/aplus-2016/rest/student/"
const homepage_url = "https://allocate.timetable.monash.edu/aplus-2016/student/"
const cred_store_file = "savedcreds.json";
var request = require("request").defaults({jar: true});
var data;
var groups = [];

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
				event.sender.send("login-reply", true);
			});
		}
	});
});

ipcMain.on("async-get-data", function (event) {
	event.sender.send("get-data-reply", data);
})

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
