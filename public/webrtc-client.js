var PeerConnection = window.PeerConnection || window.webkitPeerConnection00 || window.webkitRTCPeerConnection || mozRTCPeerConnection;
var URL = window.URL || window.webkitURL || window.msURL || window.oURL;
var getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
var RTCSessionDescription = RTCSessionDescription || mozRTCSessionDescription;
(function(exports) {
	function RTCClient() {
		this.SERVER = {
			iceServers: [{
				url: "stun:" + location.hostname + ":9001"
			}]
		};
		//createOffer createAnswer 第三个参数RTCOfferOptions
		var mediaConstraints = { 
			optional: [],
			mandatory: {
				OfferToReceiveAudio: true,
				OfferToReceiveVideo: true
			}
		};
		this.eventHandlers = {};
		this.channel = null;
		this.localStreams = [];
		this.peerConnections = {};
		var events = {
			//peer event
			iceCandidate: "iceCandidate",
			createOffer: "createOffer",
			createAnswer: "createAnswer",
			addStream: "addStream", // {stream:stream,remoteId:""}
			removeStream: "removeStream",
			//local event
			signalingStateChange: "signalingStateChange",
			peerConnectionOpen: "peerConnectionOpen",
			channelOpen: "channelOpen",
			//server event
			removeConnection: "removeConnection",
			newConnection: "newConnection",
			getConnections: "getConnections"
		};
		this.events = events;
		var me = this;
		this.addEventListener = function(eventName, callback) {
			if (!this.eventHandlers[eventName]) this.eventHandlers[eventName] = [];
			this.eventHandlers[eventName].push(callback);
		};

		this.fireEvent = function(eventName, data) {
			console.log("receiveEvent[%s] :", eventName, data);
			var callbacks = me.eventHandlers[eventName];
			if (callbacks) {
				for (var i = callbacks.length - 1; i >= 0; i--) {
					callbacks[i](data);
				};
			}
		}

		this.attachStream = function(stream, dom) {
			if (window.URL) { //chrome
				dom.src = URL.createObjectURL(stream);
			} else {
				dom.mozSrcObject = stream;
			}
		};
		this.start = function(config) {
			if (typeof WebSocket === 'undefined') {
				me.fireEvent("error", new {
					message: "浏览器不支持WebSocket"
				});
			}
			if (getUserMedia) {
				getUserMedia.call(navigator, config.constraints, function(stream) {
					me.attachStream(stream, config.localVideo);
					me.localStreams.push(stream);
					connect(config.channel);
				}, function(error) {
					me.fireEvent("error", {
						message: "获取本地媒体失败",
						error: error
					});
				});
			} else {
				me.fireEvent("error", {
					message: 'webRTC is not yet supported in this browser.'
				})
			}
		}

		function connect(channel) {
			var wsChannel = new WebSocket("ws://" + location.host + "/" + channel);
			wsChannel.onopen = function() {
				me.fireEvent(events.channelOpen, wsChannel);
				wsChannel.onmessage = function(msg) {
					var message = null;
					try {
						message = JSON.parse(msg.data);
					} catch (ex) {
						console.error("parse message fialed :", msg.data);
					}
					me.fireEvent(message.eventName, message);
				}
			}
			wsChannel.onclose = function() {
				console.log("channel[%s] close", channel);
			}

			wsChannel.onerror = function(err) {
				console.error("channel[%s] error", err);
			}
			me.channel = {
				send: function(data) {
					wsChannel.send(JSON.stringify(data));
					console.log("sendEvent[%s]:", data.eventName, data);
				}
			};
		}
		this.addEventListener(events.removeConnection, function(message) {
			var remoteId = message.data;
			delete me.peerConnections[remoteId];
		});
		this.addEventListener(events.newConnection, function(message) {
			var pc = new PeerConnection(me.SERVER);
			var remoteId = message.data;
			createPeerConnection(remoteId);
		});

		function createPeerConnection(remoteId) {
			var pc = new PeerConnection(me.SERVER);
			me.peerConnections[remoteId] = pc;
			for (var i = me.localStreams.length - 1; i >= 0; i--) {
				pc.addStream(me.localStreams[i]);
			};
			pc.onicecandidate = function(event) {
				if (event.candidate) {
					var message = {
						eventName: events.iceCandidate,
						data: event.candidate,
						to: remoteId
					};
					me.channel.send(message);
				}
			}
			pc.onsignalingstatechange = function() {
				me.fireEvent(events.signalingStateChange, {
					remoteId: remoteId,
					state: pc.signalingState
				});
			};
			pc.onopen = function() {
				me.fireEvent(events.peerConnectionOpen, {
					remoteId: remoteId
				});
			}
			pc.onaddstream = function(event) {
				me.fireEvent(events.addStream, {
					stream: event.stream,
					remoteId: remoteId
				});
			};
			pc.onremovestream = function(event) {
				me.fireEvent(events.removeStream, {
					stream: event.stream,
					remoteId: remoteId
				});
			}
			return pc;
		}

		this.addEventListener(events.getConnections, function(message) {
			var connections = message.data;
			for (var i = connections.length - 1; i >= 0; i--) {
				(function() {
					var remoteId = connections[i];
					var pc = createPeerConnection(remoteId);
					console.log("create offer to %s", remoteId);
					//create offer
					pc.createOffer(function(session_description) {
						pc.setLocalDescription(session_description);
						var msg = {
							eventName: events.createOffer,
							to: remoteId,
							data: session_description
						};
						console.log("send %s", remoteId);
						me.channel.send(msg);
					}, function(error) {
						me.fireEvent("error", {
							message: "create offer fialed",
							error: error
						});
					},mediaConstraints);
				})();
			};
		});

		this.addEventListener(events.iceCandidate, function(message) {
			var pc = me.peerConnections[message.from];
			var candidate = new RTCIceCandidate(message.data);
			pc.addIceCandidate(candidate);
		});

		this.addEventListener(events.createOffer, function(message) {
			var pc = me.peerConnections[message.from];
			pc.setRemoteDescription(new RTCSessionDescription(message.data));
			pc.createAnswer(function(sdp) {
				pc.setLocalDescription(sdp);
				var returnMsg = {
					eventName: events.createAnswer,
					data: sdp,
					to: message.from
				};
				me.channel.send(returnMsg);
			}, function(err) {
				console.error("create answer error", err);
				alert(err);
			},mediaConstraints);
		})

		this.addEventListener(events.createAnswer, function(message) {
			var pc = me.peerConnections[message.from];
			var answer = new RTCSessionDescription(message.data);
			pc.setRemoteDescription(answer);
		})
	}
	exports.RTCClient = RTCClient;
})(window);