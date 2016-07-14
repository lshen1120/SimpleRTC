var express = require('express'),
  http = require('http'),
  logger = require('morgan');
  rtcServer=require("./rtc-server")
  app = express();
var fs = require('fs');

var https = require('https');
var hskey = fs.readFileSync('cert/hacksparrow-key.pem');
var hscert = fs.readFileSync('cert/hacksparrow-cert.pem')
var options = {
    key: hskey,
    cert: hscert
};

var stunServer = require('stunsrv').createServer();
stunServer.setAddress0("127.0.0.1");
stunServer.setAddress1('0.0.0.0'); //外网IP
stunServer.setPort0(9001);
stunServer.setPort1(9001);

app.set('port', process.env.PORT || 8000);
app.use(express.static(__dirname + '/public'));
app.use(logger("dev"));


var httpServer=https.createServer(options,app).listen(app.get('port'), function() {
  console.log("Express server listening on port " + app.get('port'));
});
rtcServer.listen(httpServer);
stunServer.listen();
