var WebSocketServer = require('ws').Server,
	events = require("events"),
	util = require("util");
/*
	message:{
		type:"createOffer",
		to:""
	}
	event:wsConnected  data:ws
	event:wsMessage   data:{ ws:ws message:message }
	event:wsClose  data:ws
	event:getConnections data:remoteConnections
*/
function RTCServer() {
	events.EventEmitter.call(this);
	this.eventHooks = [];
	this.channels = {};
	this.connections = {};
	this.wss = null;
	var me = this;
	//触发普通事件和hook事件
	function fireEvent(eventName, data) {
		me.emit(eventName, data);
		for (var i = me.eventHooks.length - 1; i >= 0; i--) {
			me.eventHooks[i](eventName, data);
		};
	}

	function addConnection(ws) {
		me.connections[ws.id] = ws;
		var channelId = ws.channelId;
		if (!me.channels[channelId]) {
			me.channels[channelId] = {};
		}
		me.channels[channelId][ws.id] = ws;
	}

	function getDictCount(obj) {
		var cnt = 0;
		for (var key in obj) cnt++;
		return cnt;
	}

	function removeConnection(ws) {
		var channelId = ws.channelId,
			channel=me.channels[channelId];
		delete channel[ws.id];
		delete me.connections[ws.id];
		//channel没有用户,删除channel
		if (getDictCount(me.channels[channelId]) == 0) {
			delete me.channels[channelId];
		}
	}

	this.addEventHook = function(hookCallbak) {
		this.eventHooks.push(hookCallbak);
	}
	this.listen = function(httpServer) {
		var wss = new WebSocketServer({
			server: httpServer
		});
		this.wss=wss;
		wss.on("connection", function(ws) {
			var id = ws._socket.remoteAddress + ":" + ws._socket.remotePort; //IP port作为唯一标识
			var channelId = ws.upgradeReq.url.substr(1);
			ws.id = id;
			ws.channelId = channelId;
			addConnection(ws);
			fireEvent("wsConnected", ws)
			ws.on('message', function(msgStr) {
				try {
					var msg = JSON.parse(msgStr);
					fireEvent("wsMessage", {
						ws: ws,
						message: msg
					})
				} catch (ex) {
					console.error("message parse error,message:" + msgStr);
				}
			});
			ws.on('close', function() {
				removeConnection(ws);
				fireEvent("wsClose", ws);
			});
		});
	}

	//log
	this.on("wsConnected", function(ws) {
		console.log("%s connected to channel[%s]", ws.id, ws.channelId);
	});
	this.on("wsMessage", function(data) {
		console.log("%s -> server :", data.ws.id, data.message);
	});
	this.on("wsClose", function(ws) {
		console.log("%s disconnected from channel[%s]", ws.id, ws.channelId);
	});

	//message process
	this.on("wsMessage", function(data) {
		var ws = data.ws,
			message = data.message;
		//指向性消息
		if (message.to) {
			if(message.to == "broadcast" ){//广播消息
				return;
			}
			var remoteWs = me.connections[message.to];
			if (remoteWs) {
				message.from = ws.id;
				remoteWs.send(JSON.stringify(message));
				console.log("Server -> %s :", remoteWs.id, message);
			}else{
				console.warn("remoteId[%s] not existed",message.to);
			}
		}
	});

	//连接成功发送channel中其他连接信息
	this.on("wsConnected", function(ws) {
		var remoteConnections = [],
			channel = me.channels[ws.channelId];
		for (var wsId in channel) {
			if (channel[wsId] != ws) {
				remoteConnections.push(wsId);
				var message = {
					type: "newConnection",
					connectionId: ws.id,
					from: "Server"
				};
				channel[wsId].send(JSON.stringify(message));
				console.log("Server -> %s :", wsId, message);
			}
		}
		if (remoteConnections.length > 0) {
			var message = {
				type: "getConnections",
				connectionIds: remoteConnections,
				from: "Server"
			};
			ws.send(JSON.stringify(message));
			console.log("Server -> %s :", ws.id, message);
		}
	});

	this.on("wsClose", function(ws) {
		var channel = me.channels[ws.channelId];
		for (var wsId in channel) {
			if (channel[wsId] != ws) {
				if (channel[wsId] != ws) {
					var message = {
						type: "removeConnection",
						connectionId: ws.id,
						from: "Server"
					};
					channel[wsId].send(JSON.stringify(message));
					console.log("Server -> %s :", channel[wsId].id, message);
				}
			}
		}
	});
}
util.inherits(RTCServer, events.EventEmitter);
module.exports.listen = function(httpServer) {
	var server = new RTCServer();
	server.listen(httpServer);
}
