var PeerConnection = window.PeerConnection || window.webkitPeerConnection00 || window.webkitRTCPeerConnection || mozRTCPeerConnection;
var URL = window.URL || window.webkitURL || window.msURL || window.oURL;
var getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
var RTCSessionDescription = RTCSessionDescription || mozRTCSessionDescription;
(function(exports) {
	function RTCClient() {
		this.SERVER = {
			iceServers: [{
				url: "stun:" + location.hostname + ":9001"
			}, {
				"url": "turn:211.64.115.116?transport=tcp",
				"credential": "shij",
				"username": "shij"
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
		this.config = null;
		var events = {
			//peer event
			iceCandidate: "candidate", // {candidate:"",from:""}
			createOffer: "createOffer", // {sdp:"",from:""}
			createAnswer: "createAnswer", // {sdp:"",from:""}
			addStream: "addStream", // {stream:stream,from:""}
			removeStream: "removeStream", // {stream:stream,from:""}
			signalingStateChange: "signalingStateChange", // {connectionId:"",state:""}
			peerConnectionOpen: "peerConnectionOpen", //  {connectionId:""}
			//local event
			channelOpen: "channelOpen", //  { channel:"" }
			error: "error", //{ error:Objcet , errorMessage:""}
			//server event
			removeConnection: "removeConnection", // { connectionId:""  }
			newConnection: "newConnection", // { connectionId:""  }
			getConnections: "getConnections" // { connectionIds:[] }
		};
		this.events = events;
		var me = this;
		this.addEventListener = function(type, callback) {
			if (!this.eventHandlers[type]) this.eventHandlers[type] = [];
			this.eventHandlers[type].push(callback);
		};

		this.fireEvent = function(type, data) {
			data.type = type;
			console.log("receiveEvent:", data);
			var callbacks = me.eventHandlers[type];
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
		/*
		*config:{
			localVideo:dom
			remoteVideo:dom,//如果有多个远程连接,不能设置此选项,需要监听addStream事件
			constraints:{video:true,autio:true}
			channel:ws://192.168.1.161/12345
		}
		*/
		this.start = function(config) {
			me.config = config;
			if (typeof WebSocket === 'undefined') {
				me.fireEvent("error", {
					errorMessage: "浏览器不支持WebSocket"
				});
				return;
			}
			if (getUserMedia) {
				getUserMedia.call(navigator, config.constraints, function(stream) {
					me.attachStream(stream, config.localVideo);
					me.localStreams.push(stream);
					connect(config.channelUrl);
				}, function(error) {
					me.fireEvent("error", {
						errorMessage: "获取本地媒体失败",
						error: error
					});
				});
			} else {
				me.fireEvent("error", {
					errorMessage: 'webRTC is not yet supported in this browser.'
				})
			}
		}

		function connect(channelUrl) {
			var wsChannel = new WebSocket(channelUrl);
			wsChannel.onopen = function() {
				me.fireEvent(events.channelOpen, {
					channel: wsChannel
				});
				wsChannel.onmessage = function(msg) {
					var event = null;
					try {
						event = JSON.parse(msg.data);
					} catch (ex) {
						console.error("parse message fialed :", msg.data);
						return;
					}
					me.fireEvent(event.type, event);
				}
			}
			wsChannel.onclose = function() {
				console.log("channel[%s] close", channel);
			}

			wsChannel.onerror = function(err) {
				console.error("channel[%s] error", err);
			}
			me.channel = {
				send: function(event) {
					wsChannel.send(JSON.stringify(event));
					console.log("sendEvent:", event);
				}
			};
		}

		function removePeer(remoteid) {
			if (me.peerConnections[remoteid]) {
				me.peerConnections[remoteid].close();
				delete me.peerConnections[remoteid];
				if (me.config.remoteVideo) {
					me.config.remoteVideo.src = "";
				}
			}
		}

		function createPeerConnection(remoteid) {
			var pc = new PeerConnection(me.SERVER);
			me.peerConnections[remoteid] = pc;
			for (var i = me.localStreams.length - 1; i >= 0; i--) {
				pc.addStream(me.localStreams[i]);
			};
			pc.onicecandidate = function(event) {
				if (event.candidate) {
					me.channel.send({
						type: events.iceCandidate,
						candidate: event.candidate,
						to: remoteid
					});
				}
			}
			pc.onsignalingstatechange = function() {
				me.fireEvent(events.signalingStateChange, {
					connectionId: remoteid,
					state: pc.signalingState
				});
			};
			pc.onopen = function() {
				me.fireEvent(events.peerConnectionOpen, {
					connectionId: remoteid
				});
			}
			pc.onaddstream = function(event) {
				var remoteVideo = me.config.remoteVideo;
				if (remoteVideo) {
					me.attachStream(event.stream, remoteVideo);
					remoteVideo.id = "remote" + remoteid;
				}
				me.fireEvent(events.addStream, {
					stream: event.stream,
					from: remoteid
				});
			};
			pc.onremovestream = function(event) {
				me.fireEvent(events.removeStream, {
					stream: event.stream,
					from: remoteid
				});
			}
			return pc;
		}


		//server events
		this.addEventListener(events.removeConnection, function(event) {
			removePeer(event.connectionId);
		});

		this.addEventListener(events.newConnection, function(event) {
			var pc = new PeerConnection(me.SERVER);
			createPeerConnection(event.connectionId);
		});

		this.addEventListener(events.getConnections, function(event) {
			var connections = event.connectionIds;
			for (var i = connections.length - 1; i >= 0; i--) {
				(function() {
					var remoteid = connections[i];
					var pc = createPeerConnection(remoteid);
					console.log("create offer to %s", remoteid);
					//create offer
					pc.createOffer(function(session_description) {
						pc.setLocalDescription(session_description);
						var msg = {
							type: events.createOffer,
							to: remoteid,
							sdp: session_description
						};
						me.channel.send(msg);
					}, function(error) {
						me.fireEvent("error", {
							errorMessage: "create offer fialed",
							error: error
						});
					}, mediaConstraints);
				})();
			};
		});

		//peer events
		this.addEventListener(events.iceCandidate, function(event) {
			var pc = me.peerConnections[event.from];
			var candidate = new RTCIceCandidate(event.candidate);
			pc.addIceCandidate(candidate);
		});

		this.addEventListener(events.createOffer, function(event) {
			var pc = me.peerConnections[event.from];
			var remoteSdp = new RTCSessionDescription(event.sdp);
			pc.setRemoteDescription(remoteSdp, function() {
					pc.createAnswer(function(sdp) {
						pc.setLocalDescription(sdp);
						me.channel.send({
							type: events.createAnswer,
							sdp: sdp,
							to: event.from
						});
					}, function(err) {
						me.fireEvent("error", {
							errorMessage: "create answer fialed",
							error: err
						});
					}, mediaConstraints);
				},
				function(err) {
					me.fireEvent("error", {
						errorMessage: "setRemoteDescriptionfialed",
						error: err
					});
				});
		});

		this.addEventListener(events.createAnswer, function(event) {
			var pc = me.peerConnections[event.from];
			var answer = new RTCSessionDescription(event.sdp);
			pc.setRemoteDescription(answer);
		});

		this.addEventListener(events.removeStream, function(event) {
			removePeer(event.from);
		});
	}
	exports.RTCClient = RTCClient;
})(window);