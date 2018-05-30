var express = require('express');
var path = require('path');
var IO = require('socket.io');
var socketioJwt   = require("socketio-jwt");
const jwt = require('jsonwebtoken');
var router = express.Router();
const _ = require('lodash');
const uuidv4 = require('uuid/v4');
//uuidv4(); // ⇨ '416ac246-e7ac-49ff-93b4-f7e94d997e6b'

//const telephoneUtils = require('./');
const JWT_SECRET = 'sshhhhhhh';

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
var privateConversations = [];

// Messages will be picked at random from this list - if message equals 'End Of Conversation' conversation shall terminate
var randomMessages = ["Oranges", "Apples", "Mangoes", "Bananas", "Grapes", "Peach", "Guava", "End Of Conversation"];

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
var decoded_token = {};


//// With socket.io >= 1.0 ////
socketIO.use(socketioJwt.authorize({
  secret: JWT_SECRET,
  handshake: true
}));
///////////////////////////////

socketIO.on('connection', function (socket) {

  var groupID = socket.decoded_token["telephone"]["groups"][0];   // 获取组建ID // 
  var currentGroupID = '';
  console.log(socket.decoded_token,"####################################");	
  /*
  Decoded token example:
	{ telephone:
	   { groups: [ 'group_1', 'group_2', 'group_6' ],
		 TelephoneSerial: 'Tel_323456789',
		 LastLogin: 1527603746783,
		 Active: true,
		 CreatedAt: 1527593748588 },
	  iat: 1527603823,
	  exp: 1527611023 
	}
  */
  
  
  var telephone = '';
  

  socket.on('join', function (telephoneSerial) {
    decoded_token = socket.decoded_token["telephone"];
	currentGroupID = decoded_token["groups"][0];
	if(!telephoneSerial === socket.decoded_token["telephone"]["TelephoneSerial"]) {
		console.error("Security Breach: Client is probably tampering with tokens");
		console.log("Serial: ", telephoneSerial, " Token: ", token);
		socket.emit('disconnect')
	}
	
	telephone = decoded_token["TelephoneSerial"];
	
	// 1. Add Clients to all groups in its token payload
	// 2. Add Client to Active Clients list data structure
	// 3. Mark client as active in DynamoDB
	
	try {
		
		// 将电话号昵称加入组建名单中
		for(let i=0; i < decoded_token["groups"].length; i++) {
			// If group doesn't exist in live group list, first add it to group_list
			if (!groupInfo[decoded_token["groups"][i]]) {
			  groupInfo[decoded_token["groups"][i]] = {};	// add the group to group list if it doesn't exist		  
			}
			
			// Next confirm if telephone client doesn't already exist in the active group list & Active Clients list, if it does
			// Then take it out and then add afresh
			if (!activeClients[telephone]) {
				// Add to active telephones list
				activeClients["telephone"] = {
					socketID: socket.id,
					lastLogin: new Date().getTime(),
					recentMessages: []
				};
				
				// Add telephone to each group it is registered
				groupInfo[decoded_token["groups"][i]][telephone] = socket.id;
				socket.join(decoded_token["groups"][i]);    // 加入组建 - Subscribe telephone to respective socket.io room with matching name
			}
		}
		
		
		//以后可以保存在数据库 - save group data to db for persistence
		// If got here then client successfully added to groups and active list - Change client DynamoDB record - Active: true
		dbChangeClientStatus(telephone, true);
		
		// 通知组建内人员
		socketIO.to(groupID).emit('sys', telephone + '加入了组建', Object.keys(groupInfo[groupID]));  
		console.log(telephone + '加入了' + groupID);
		
		
	} catch(err){
		console.error("There was a error handling the token data on client join");
		console.error(err);
		console.log("Client: ", telephone, "; Time: ", new Date().getTime());
	}

    
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
			
		if (groupInfo[groupID][telephone]) {
		  delete groupInfo[groupID][telephone];
		}
		
	} else {
		// This case means client disconnected by clicking the inactivate button - so mark as Inactive and post to DB
		// Step 0 - Unsubscribe client from all Socket IO rooms he's listening
		// Step 1 - Take telephone client off the active lists --> groupInfo
		//			Lists to take client off:
		//				a) groupInfo > from each group list - have to loop NB: reason is not to take client from persisted groups in db.
		//																	- reason is to take him off the live working list on server
		//				b) activeClients list
		// Step 2 - mark telephone client as inactive (in DB)
		
		console.log(reason, "+++++++++++++++++++++++++++++");
		
		for(let i=0; i < decoded_token['groups'].length; i++) {
			// Leave each socket group in list
			// But don't deregister in DB, just here to make it inactive
			socket.leave(decoded_token['groups'][i]);    // 退出组建
			socketIO.to(decoded_token['groups'][i]).emit('sys', telephone + '退出了组建', Object.keys(groupInfo[decoded_token['groups'][i]]));
			console.log(telephone + 'exit group' + groupID);
			
			//for each group in groupInfo active clients OBJECT list, remove this telephone groupInfo[decoded_token['groups'][i]]
			if (groupInfo[decoded_token['groups'][i]][decoded_token["TelephoneSerial"]]){
				// delete this telephone OBJECT (not string) from groupInfo[group] array 
				delete groupInfo[decoded_token['groups'][i]][decoded_token["TelephoneSerial"]];
			} 
			
		}
		
		// Next take client off activeClients list
		if(activeClients[decoded_token["TelephoneSerial"]]){
			// Telephone is active - remove it
			delete activeClients[decoded_token["TelephoneSerial"]];
		}
		
	}
    
    
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
	if(msg === 'startBroadcast'){
		// starts a broadcast
		
		// Send message to group - with acknowledgements
	    // on acknlowledge - save to array  - thus first acknowledger would be first in array
	    // can include timestamps in save for verification
	    // Data to save socket ID, telephoneSerial
	    // thus acknowlege calls on client send back serial
	    // initiate communication with first respondent
		//let message = {content: 'STARTMESSAGE', messageID: Math.floor(Date.now() / 1000 * Math.random())};
		//socketIO.to(groupID).emit('sequence',telephone, message); // Broadcast to all telephones in group
		
		initBroadcast(socketIO, 'group_1', "Nakuona msee ------- nakuona na ii broadcast");
		
	} else if(msg === 'startPrivate'){
		// Starts a private conversation with sender
		let mes = randomMessages[randomMessages.length - 1];
		while(mes === randomMessages[randomMessages.length - 1]) {
			// prevents server from sending the last message - let client do it
			mes = randomMessages[Math.floor(Math.random()* randomMessages.length)];
		}
		
		let data = {
			convID: uuidv4(),
			messageID: uuidv4(),
			socketID: socket.id, // for this instance we are communicating with specified client int this case sender
			content: mes,
			telephoneSerial: decoded_token['TelephoneSerial']
			

		};
		startPrivateConv(data);
		
	}else if( typeof msg === 'object' && msg['telephoneSerial']){
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
				console.log(broadcasts[broadcastPos].broadcastListReduceBuff, "niniiiiiiiiii"); // logged to see original members before reduction
				
				// Initiate private conversation with our first responder
				let mes = randomMessages[randomMessages.length - 1];
				while(mes === randomMessages[randomMessages.length - 1]) {
					// prevents server from sending the last message - let client do it
					mes = randomMessages[Math.floor(Math.random()* randomMessages.length)];
				}
				
				let data = {
					convID: uuidv4(),
					messageID: uuidv4(),
					socketID: socket.id, // for this instance we are communicating with first responder
					content: mes,
					telephoneSerial: decoded_token['TelephoneSerial']
					

				};
				startPrivateConv(data);
				privateConversations.push(data);
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
	    socketIO.to(currentGroupID).emit('msg', telephone, message);
		
	}
	
  });
  
  socket.on('privateConversation', function (msg) {
	  console.log(`%%%%%%%%%%%%%%%%%%%%% Conversation ID: ${msg.convID} %%%%%%%%%%%%%%%%%%%%%%%%%%%`);
	  console.log(msg, "nini wewe");
	  
	  //Every emit of this privateConversation on server is also considered an ACK message for a previously sent server message
	  // Sv == Server ; Ct == Client
	  // a) Sv_privateConversationStarted to Ct b) Ct_privateConversation to server -- from here all events are privateConversation from both Sv and Ct
	  // Every invocation of Sv_privateConversation is treated as ACK to previous message it sent to Ct
	  
	  // TODO: Record this ACK
	  console.log("Private Conversation ACK received from: ", msg.telephoneSerial, " CoversationID: ", msg.convID, " ACK message ID: ", msg.messageID);
	  
	  
	  if(msg.content !== randomMessages[randomMessages.length - 1]){
		  // Continue with conversation untill client sends appropriate end conversation message:
		 // In this case it will be equal the last message in our array
		 
		 // Initiate private conversation with our first responder
		let mes = randomMessages[randomMessages.length - 1];
		while(mes === randomMessages[randomMessages.length - 1]) {
			// prevents server from sending the last message - let client do it
			mes = randomMessages[Math.floor(Math.random()* randomMessages.length)];
		}
		 
		 // Keep conversation private going
		let data = {
			convID: msg.convID, // we are still on same conversation so use uuid sent by client - need to validate this later
			messageID: uuidv4(), // new uuid for current message
			socketID: socket.id, // for this instance we are communicating with first responder
			content: mes,
			telephoneSerial: msg.telephoneSerial	

		};
		 
		 socket.emit('privateConversation', data);		 
	  }
	  
  });
 
});


 /**
	* Initiates private conversation sequence with a client that responded first to a group broadcast
  **/
var startPrivateConv = function (data) {
	// data param has structure:
	/*
		{
			convID: new Coversation UUID, - A new Identifier for the conversation about to start
			messageID: new UUID,  - this starting message ID
			socketID: Socket ID - MUST be passed to enable starting of conversation with ANY client
			content: Message content,
			telephoneSerial: Telephone Serial
		}
	*/
	
	// 1. PrivateConversationStarted init event to client (using socket ID param)
	// 2. The client is always listening for PrivateConversationStarted, when it receives it, it posts the message content to message list
	// 3. Client then emits privateConversation event to server
	// 4. Server uses the privateConversation event to have private conversations with a single client
	// 5. Reason for doing this is to enable acknowlegments for messages sent to client - only available when speaking to single client via -->> socket.emit('question', 'do you think so?', function callBackHandlesACK (answer) {});
	// 6. Inside the server's privateConversation callback listener that handles ACK, we can do a recursive emit of the same event to keep conversation going
	// 7. We can have a condition to determine whether to continue conversation or not (by emitting the event again)
	// 8. Inside this callback also need to log this invocation as a successful
	
	
	
  console.log("++++++++++++++++ Private Conversation initiated with ", data.socketID, data.telephoneSerial," ++++++++++++++++++++++");
  socketIO.to(data.socketID).emit('privateConversationStarted', data);
}

// Sends a sys message to remove a message from a single client
var removeMessageSingle = function (telephoneSerial, messageID) {
  
}

// Sends a sys message to remove a message from all clients in a group
var removeMessageGroup = function (groupID, messageID) {
  
}

/**
  * This function initiates a broadcast to all clients in the group in the groups array
  * @param groups - arraystring - the group identifiers
  *
**/
var initBroadcast = function (socketIOObj, groups, message){
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

var dbChangeClientStatus = function(telephoneSerial, activeStatus) {
	// TODO: validate params passed first
	
	//TODO: Add login to post status change to DynamoDB
	console.log("Telephone DB status changed to Active");
	
}



/*
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

*/

router.get('/telephone', function (req, res) {
  var token = '';
  let groupID = '';
  let groupList = [];
  if(req.query.token){
	  token = req.query.token;
  } else {
	  // TODO: return error to client, session token not valid
	  res.send(401);
  }
   
  
	//Decode the received token and ensure it is VALID and NOT EXPIRED
	jwt.verify(token, JWT_SECRET, function(err, decoded) {
		if(err){
			console.error("Login failed. Invalid token sent by client. Token: ", token);
			//send unauthorized page|message
			res.send(401);
		}
		console.log("--------------------------------------------------");
		console.log(decoded);
		
		groupID = decoded["telephone"]["groups"] ? decoded["telephone"]["groups"][0] : ''; // TODO: handle error incase groups list is empty for this client meaning telephone doesn't belong to any group
		groupList = decoded["telephone"]["groups"] ? decoded["telephone"]["groups"] : [];
	});
  // We need to get number of active telephones in group from groupInfo structure
  let telephones = [];
  try {
	  telephones = Object.keys(groupInfo[groupID]);
  } catch(err){
	  console.error(err.message);
	  telephones = [];
  }
  
 
  // 渲染页面数据(见views/telGroups.hbs)
  res.render('telGroups', {
    groupID: groupID, // default - populate with first group in group list inside token payload
	groupList: groupList, //Groups this telephone belongs to
    telephones: telephones,
	token: token
  });
});

app.use('/', router);

server.listen(3000, function () {
  console.log('server listening on port 3000');
});
