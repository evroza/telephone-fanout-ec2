var express = require('express');
var path = require('path');
var IO = require('socket.io');
var socketioJwt   = require("socketio-jwt");
var router = express.Router();
const _ = require('lodash');
const uuidv4 = require('uuid/v4');
//uuidv4(); // ⇨ '416ac246-e7ac-49ff-93b4-f7e94d997e6b'

const telephoneUtils = require('./');

var app = express();
var server = require('http').Server(app);
app.use(express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

// 创建socket服务
var socketIO = IO(server);
// 组建电话号名单
var groupInfo = {};

// serverMessages - Stores array of server message objects {messageID: MESSAGE_ID, contents: CONTENTS, timestamp: 131312323}
/*
	{
		untagged: [{telephoneSerial: TELEPHONE_SERIAL, socketID: SOCKET_ID_OF_CLIENT, messageID: MESSAGE_ID, contents: CONTENTS}, .....],
		group_1 : [{messageID: MESSAGE_ID, contents: CONTENTS, timestamp: 131312323}, .....],
		group_2: [{messageID: MESSAGE_ID, contents: CONTENTS, timestamp: 131312323}, .....],
		.
		.
		.
	}
*/
var serverMessages = {untagged: []};


// broadcasts [Array]- Stores array of boraodcast messages initiated by server as well as associated metadata
/*
	[
		{
			id: UUID,
			groupID: groupID,
			content: 'Message text contents',
			timeInit: TimeStamp,
			success: True|False - whether the broadcast was successfully submitted - false on exception
			telephones: [ ---> First entry made on first ACK receipt, all appended to this list
				{
					telephoneSerial: 'Telephone 1 Serial',
					socketID: socket ID of telephone client,
					timeStampACK: 'Time stamp of when message acknowledgement was returned',
					clickedCTATime: [Array of timestamps when clicked by this telephone]			
				}, ...],
			displayOnFirstTelephone: True|False [Default True],
			displayOnAllTelephones: True|False [Default False] - only displays this broadcast message on first responder,
			firstACKReceived: True|False - [Default  False], turns true on first ACK receipt, Subsequent ACKS, in this 
								broadcast don't alter it's value. Used to trigger private conversation with the first responder, 
								then switched to true, subsequent ACKs find it's already true and don't try to trigger private conversation
			firstResponderACK: {
									telephoneSerial: Telephone Serial of first responder,
									socketID: current socket ID of First responder	
								
								},
			broadcastListReduceBuffSIO: arr --> socket IO list of active clients in this group
			
			
			
		},
		.
		.
		.
	]
*/

var broadcasts = [];

// activeClients {Object}- Stores object of all currently active clients on the Server. Failing nodes|telephones will 
// be removed from this list and marked as inactive in DB.
// Inactive clients are not retained in this list, they are removed and marked in DB as Inactive
/*
{
	Tel_telephoneSerial: { --> the format of serial numbers in system shall have a prepended 'Tel_' for compatibilty and performance reasons
			socketID: socketID,
			lastLogin: Timestamp,
			recentMessages: [{
					type: Broadcast|private,
					id: uuid4,
					success: true | false
			},
			.
			.
			.
			]			
			
		},
		.
		.
		.
}
*/
var activeClients = {};


//// With socket.io >= 1.0 ////
socketIO.set('authorization', socketioJwt.authorize({
  secret: 'sshhhhhhh',
  handshake: true
}));
///////////////////////////////

socketIO.on('connection', function (socket) {
  // 获取请求建立socket连接的url
  // 如: http://localhost:3000/group/group_1, groupID为group_1
  var url = socket.request.headers.referer;
  var splited = url.split('/');
  var groupID = splited[splited.length - 1];   // 获取组建ID
  var telephone = '';
  

  socket.on('join', function (telephoneSerial) {
    telephone = telephoneSerial;

    // 将电话号昵称加入组建名单中
    if (!groupInfo[groupID]) {
      groupInfo[groupID] = {};
	  
    }
    groupInfo[groupID][telephone] = socket.id;
	//以后可以保存在数据库 - save group data to db for persistence

    socket.join(groupID);    // 加入组建
    // 通知组建内人员
    socketIO.to(groupID).emit('sys', telephone + '加入了组建', Object.keys(groupInfo[groupID]));  
    console.log(telephone + '加入了' + groupID);
  });

  socket.on('leave', function () {
    socket.emit('disconnect');
  });

  socket.on('disconnect', function (reason) {
	 
	// Modify this so Client continues to stay in active list if disconnection wasn't intentional. i.e the disconnect button wasn't
	// clicked, rather - a possible network error occured. or say the browser window was closed without correctly diconnecting telephone
	// There might be other reasons not captured in this list - preliminary list for prototype
	if(reason === "transport close" && reason === "ping timeout" && reason === "Transport error"){
		// If here then reason was possible proper disconnect, so mark client as inactive,; otherwise leave him on list and
		// let message failures to his client cause him to be removed from list
		
		// Step 1 - mark telephone client as inactive (in DB)
		// Step 2 - Take telephone client off the active list --> groupInfo
		//			Lists to take client off:
		//				a) groupInfo > from each group list - have to loop NB: reason is not to take client from persisted groups in db.
		//																	- reason is to take him off the live working list on server
		//				b) 
		
		if (groupInfo[groupID][telephone]) {
		  delete groupInfo[groupID][telephone];
		}
		
	}
    
	
	console.log(reason, "+++++++++++++++++++++++++++++");
	
    socket.leave(groupID);    // 退出组建
    socketIO.to(groupID).emit('sys', telephone + '退出了组建', Object.keys(groupInfo[groupID]));
    console.log(telephone + '退出了' + groupID);
  });

  // 接收电话号消息,发送相应的组建
  socket.on('message', function (msg) {
	var privateConvStarted = false;
    // 验证如果电话号不在组建内则不给发送
    if (!groupInfo[groupID][telephone]) {  
      return false;
    }
	console.log("==================================");
	console.log(msg);
	if(msg === 'startSequence'){
		// Send message to group - with acknowledgements
	    // on acknlowledge - save to array  - thus first acknowledger would be first in array
	    // can include timestamps in save for verification
	    // Data to save socket ID, telephoneSerial
	    // thus acknowlege calls on client send back serial
	    // initiate communication with first respondent
		//let message = {content: 'STARTMESSAGE', messageID: Math.floor(Date.now() / 1000 * Math.random())};
		//socketIO.to(groupID).emit('sequence',telephone, message); // Broadcast to all telephones in group
		
		initBroadcast(socketIO, 'group_1', "Nakuona msee ------- nakuona na ii broadcast");
		
	} else if( typeof msg === 'object' && msg['telephoneSerial']){
		//Acknowledgement message from a broadcast
		console.log("Acknowledge:", msg['telephoneSerial'], "time: ", msg['clientReceivedAt']);
		console.log(socket.id);
		
		//Store Acknowledgement in array to maintain ordering of responses
		// First responder in index zero '0'
		// Add socket Id's
		msg['socketID'] = socket.id;
		msg['ackReceivedAt'] = new Date().getTime();
		
		// Add the ack messages to the specified broadcast data structure
		// ======================== 	NOTE ===========================
		// Obviously not secure - prone to crash or errors if multiple broadcasts submitted
		// in quick succession (race conditions) or malicious user is messing with broadcast id's being resubmitted
		// in acknowledgement messages
		// ===============
		//Loop starting from back end of broadcasts array finding the matching broadcast
		let broadcastPos = null;
		for(let i = broadcasts.length-1; i >= 0; i--){
			// check if broadcastID matches first
			if(broadcasts[i].id === msg.broadcastID){
				//Take note of current index then break out of loop
				//position of broadcast is ...
				broadcastPos = i;
				break;
			}
		}
		
		// First verify we found our broadcast of interest
		if (broadcastPos === null){
			console.error(new Error("Failed to locate broadcast with specified ID. There might be data corrruption. Or client is maliciously editing requests"));
			console.log("Capured client that failed >>>> ClientInfo: ", telephone, " SocketID: ", socket.id, " Time: ", new Date().getTime());
		} else{
			
			//If first ACK responder log his  special info
			// If firstResponder is not null then already received first response
			if(broadcasts[broadcastPos].firstResponder === null){
				// This is the first ACK responder to our broadcast
				broadcasts[broadcastPos].firstResponder = {
					telephoneSerial: telephone,
					socketID: socket.id,
					timestamp: new Date().getTime()					
				};
				console.log(broadcasts[broadcastPos].broadcastListReduceBuff, "niniiiiiiiiii"); // first log to see original members before reduction
			} 
			
			// Now get ACK-ing clients off the buffer list - broadcastListReduceBuff
			console.log(broadcasts[broadcastPos].broadcastListReduceBuff, "woooop"); // every ACK takes a telephone off this list
			let index = broadcasts[broadcastPos].broadcastListReduceBuff.indexOf(telephone);
			if (index > -1) {
			  broadcasts[broadcastPos].broadcastListReduceBuff.splice(index, 1);
			}
			
			// At this stage we need to set a timeout which is reset on every ack receipt, 
			// Purpose of timeout is to detect failed clients that still exist in the broadcastListReduceBuff
			// Next action is to post them to a client/Telephone data structure that keeps track of all
			// client success failure to repond to ACKS in ALL GROUPS, not just this current one. Thus we can detect
			// Clients that have consecutively failed and take them off list
			
			
			
		}
		
				
		
	} else{
		let message = {content: msg, messageID: Math.floor(Date.now() / 1000 * Math.random())};
	    socketIO.to(groupID).emit('msg', telephone, message);
		
	}
	
  });
 
});


 /**
	* Initiates private conversation sequence with a client that responded first to a group broadcast
  **/
function startPrivateConv(firstResponder) {
  console.log("++++++++++++++++++++++++++++++++++++++");
  socketIO.to(firstResponder.socketID).emit('privateSequence', firstResponder.telephoneSerial, 'You were the first, how about we talk some more!');
}

// Sends a sys message to remove a message from a single client
function removeMessageSingle(telephoneSerial, messageID) {
  
}

// Sends a sys message to remove a message from all clients in a group
function removeMessageGroup(groupID, messageID) {
  
}

/**
  * This function initiates a broadcast to all clients in the group in the groups array
  * @param groups - arraystring - the group identifiers
  *
**/
function initBroadcast(socketIOObj, groups, message){
	if (typeof socketIOObj !== 'object') {
		//Missing socket IO obj arg
		throw new Error("Must pass in the Socket IO object to init broadcast");
		return;
	}

	if(typeof groups !== 'string' && (!Array.isArray(groups) || groups.length < 1)){
		//invalid groups arg
		throw new Error("Invalid value for 'groups' param. Must be string of valid  group identifier or Array, with length greater than 0, of valid group string identifiers");
		return;
	} else{
		groups = (typeof groups === 'string') ? [groups]: groups;
	}
	if(!message || typeof message !== 'string'){
		//invalid message arg
		throw new Error("Missing value for 'message' param. Must be provided");
		return;
	}


	// 1 - First record the message in broadcasts data object
	// 1.1 - [NO NEED FOR THIS STEP - Just reduce and on timer end, all remaining clients have failed
	//							   - Compare active group clients fetched from db and socket.io active group clients ]- missing clients
	//								 auto-marked as failed on broadcast init
	// 2 - Attempt to broadcast message
	// 3 - Handle errors if any
	// Remaining is where to record the set of values missing in SIO group active list that are marked as active in groupInfo;
	// challenge SIO group active list stores socket IDs while groupInfo list stores telephone serials without socket IDs
			
	
	for(let i= 0; i < groups.length; i++ ){
		let messageUUID = uuidv4();
		broadcasts[broadcasts.length] = {
			id: messageUUID,
			content: message,
			time: new Date().getTime(),
			// receivedFirstACK: false, -- Don't need this, can check if firstResponder is null
			displayedFirst: true,
			displayedAll: false,
			firstResponder: null, // used to capture the first telephone to respond to an broadcast - Check if 
			broadcastListReduceBuff: Object.keys(groupInfo[groups[i]]),
			
		}; 
		console.log(groupInfo[groups[i]], 'weeeee')
		socketIOObj.in(groups[i]).emit('broadcast', {content: message, messageID: messageUUID });
		
	}
	
	
	
	// Mark missing clients in group
	

}






// group page
router.get('/group/:groupID', function (req, res) {
  var groupID = req.params.groupID;
  let telephones = [];
  try {
	  telephones = Object.keys(groupInfo[groupID]);
  } catch(e){
	  console.error(e.message);
  }
  

  // 渲染页面数据(见views/group.hbs)
  res.render('group', {
    groupID: groupID,
    telephones: telephones
  });
});

app.use('/', router);

server.listen(3000, function () {
  console.log('server listening on port 3000');
});
