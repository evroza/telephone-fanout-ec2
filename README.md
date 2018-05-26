
### Multi-group Telephone Fanout backend and client
socket.io key features used[rooms and namespace API](http://socket.io/docs/rooms-and-namespaces/)
With the groups API you can perform various action in a group，Important features can be summed up as：join/leave group AND send messages to server or group
```
// join and leave
io.on('connection', function(socket){
  socket.join('some group');
  // socket.leave('some group');
});

// say to group
io.to('some group').emit('some event'):
io.in('some group').emit('some event'):
```


###### Running examples
![运行效果](http://upload-images.jianshu.io/upload_images/436630-d01d00f22a54a6e3.png?imageMogr2/auto-orient/strip|imageView2/2/w/1240)

