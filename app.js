var express = require('express');
var path = require('path');
var IO = require('socket.io');
var socketioJwt   = require("socketio-jwt");
var router = express.Router();
const _ = require('lodash');
const uuidv4 = require('uuid/v4');

var app = express();
var server = require('http').Server(app);
app.use(express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

// 创建socket服务
var socketIO = IO(server);
// 组建电话号名单
var groupInfo = {};

// Stores the acknowledgements from groups  to track first acknowledger
var groupSeqTimer = {};

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
	{
		id: UUID,
		groupID: groupID,
		content: 'Message text contents',
		timeInit: TimeStamp,
		telephones: [
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
							
							}
		
		
		.
		.
		.
	}
*/


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
      groupInfo[groupID] = [];
	  if(!groupSeqTimer[groupID]){
		  groupSeqTimer[groupID] = [];
	  }
	  
    }
    groupInfo[groupID].push(telephone);
	//以后可以保存在数据库 - save group data to db for persistence

    socket.join(groupID);    // 加入组建
    // 通知组建内人员
    socketIO.to(groupID).emit('sys', telephone + '加入了组建', groupInfo[groupID]);  
    console.log(telephone + '加入了' + groupID);
  });

  socket.on('leave', function () {
    socket.emit('disconnect');
  });

  socket.on('disconnect', function () {
    // 从组建名单中移除
    var index = groupInfo[groupID].indexOf(telephone);
    if (index !== -1) {
      groupInfo[groupID].splice(index, 1);
    }

    socket.leave(groupID);    // 退出组建
    socketIO.to(groupID).emit('sys', telephone + '退出了组建', groupInfo[groupID]);
    console.log(telephone + '退出了' + groupID);
  });

  // 接收电话号消息,发送相应的组建
  socket.on('message', function (msg) {
	var privateConvStarted = false;
    // 验证如果电话号不在组建内则不给发送
    if (groupInfo[groupID].indexOf(telephone) === -1) {  
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
		let message = {content: 'STARTMESSAGE', messageID: Math.floor(Date.now() / 1000 * Math.random())};
		socketIO.to(groupID).emit('sequence',telephone, message); // Broadcast to all telephones in group
		
	} else if( typeof msg === 'object' && msg['telephoneSerial']){
		console.log("Acknowledge:", msg['telephoneSerial'], "time: ", msg['clientReceivedAt']);
		console.log(socket.id);
		
		//Store Acknowledgement in array to maintain ordering of responses
		// First responder in index zero '0'
		// Add socket Id's
		msg['socketID'] = socket.id;
		msg['ackReceivedAt'] = new Date().getTime();
		if(groupSeqTimer[groupID].length === 0) {
			groupSeqTimer[groupID].push(msg);
		}
		
		
		console.log(groupSeqTimer)
		// Immediately start conversation with the first responder
		if(groupSeqTimer[groupID].length === 1){
			// Call this only when the first responder has acknowledged mesage, otherwise ignore
			//Initiate private conversations with this first responder - best done in another function
			// 
			privateConvStarted = true;						
			startPrivateConv(groupSeqTimer[groupID][0]);
			
			// Clear the groupSeqTimer after this
			//groupSeqTimer[groupID] = [];		
		}
		
		
		socketIO.of('/').adapter.clients([groupID], (err, clients) => {
		  console.log(clients); // an array containing all connected socket ids in this group
		  // First remove inactive/ disconnected clients from this list -- groupSeqTimer[groupID]
		  _.forEach(groupSeqTimer[groupID], function(val,key,obj) {
			  
			  if( clients.indexOf(val.socketID) !== -1 ){
				  // the client isn't connected anymore - remove it from groupSeqTimer
				  //obj.splice(key, 1);
			  }
			  
			});
		  
		}); 
		
	} else{
		let message = {content: msg, messageID: Math.floor(Date.now() / 1000 * Math.random())};
	    socketIO.to(groupID).emit('msg', telephone, message);
		
	}
	
  });
  
  /**
	* Initiates private conversation sequence with a client that responded first to a group broadcast
  **/
  function startPrivateConv(firstResponder) {
	  console.log("++++++++++++++++++++++++++++++++++++++");
	  socketIO.to(firstResponder.socketID).emit('privateSequence', telephone, 'You were the first, how about we talk some more!');
  }
  
  // Sends a sys message to remove a message from a single client
  function removeMessageSingle(messageID) {
	  
  }
  
  // Sends a sys message to remove a message from all clients in a group
  function removeMessageGroup(messageID, groupID) {
	  
  }

});




// group page
router.get('/group/:groupID', function (req, res) {
  var groupID = req.params.groupID;

  // 渲染页面数据(见views/group.hbs)
  res.render('group', {
    groupID: groupID,
    telephones: groupInfo[groupID]
  });
});

app.use('/', router);

server.listen(3000, function () {
  console.log('server listening on port 3000');
});
