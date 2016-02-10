const menubar = require('menubar');
const path = require('path');
const electron = require("electron");
const Menu = electron.Menu;
const MenuItem = electron.MenuItem;
const app = electron.app;
const ipcMain = electron.ipcMain;
const api_url = "https://allocate.timetable.monash.edu/aplus-2016/rest/student/"
const homepage_url = "https://allocate.timetable.monash.edu/aplus-2016/student/"
var request = require("request").defaults({jar: true});
var data;

ipcMain.on("async-login", function(event, username, password) {
	request.post({url: api_url +"login", form: {username: username, password: password}}, function (_, _, login){
		var login = JSON.parse(login);
		if (!login.success) {
			event.sender.send("login-reply", false);
		} else {
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
