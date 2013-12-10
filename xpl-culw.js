var Xpl = require("xpl-api");
var program = require('commander');
var serialport = require("serialport");
var CulwSerial = require('./lib/culw-serial');
var os = require('os');

program.version('0.0.1')
		.option("-s, --serialPort <path>", "Serial device path");

Xpl.fillCommander(program);

program.command('listSerialPort').description("List serial ports").action(
		function() {

			console.log("List serial ports:");
			serialport.list(function(err, ports) {
				if (err) {
					console.log("End of list");

					process.exit(0);
				}
				ports.forEach(function(port) {
					console.log("  Port name='" + port.comName + "' pnpId='"
							+ port.pnpId + "' manufacturer='"
							+ port.manufacturer + "'");
				});
				console.log("End of list");

			});
		});

program.command('start').description("Start processing CULW datas").action(
		function() {
			console.log("Start");
			
			if (!program.serialPort) {
				switch(os.platform()) {
				case "win32":
					program.serialPort="COM4";
					break;
				case "linux":
					program.serialPort="/dev/serial/by-id/usb-busware.de_CUL868-if00";
					break;
				}
				
				console.log("Use default serial port : "+program.serialPort);
			}

			var sp = new serialport.SerialPort(program.serialPort, {
				baudrate : 9600,
				databits : 8,
				stopbits : 1,
				parity : 'none',
				rtscts : false,
				parser : serialport.parsers.readline("\n")
			});

			sp.on("open", function(error) {
				try {
					if (error) {
						console.log("Can not open serial device '"
								+ program.serialPort + "'", error);
						process.exit(1);
						return;
					}
					console.log("Serial device '" + program.serialPort
							+ "' opened.");

					if (!program.xplSource) {
						var hostName=os.hostname();
						if (hostName.indexOf('.')>0) {
							hostName=hostName.substring(0, hostName.indexOf('.'));
						}

						program.xplSource="culw." + hostName;
					}
					
					var xpl = new Xpl(program);

					xpl.on("error", function(error) {
						console.log("XPL error", error);
					});

					xpl.bind(function(error) {
						if (error) {
							console.log("Can not open xpl bridge ", error);
							process.exit(2);
							return;
						}

						console.log("Xpl bind succeed ");

						new CulwSerial(function(data, callback) {
							// console.log("Write '" + data + "'");
							sp.write(data, callback);

						}, function(body, callback) {
							xpl.sendXplTrig(body, callback);

						}, {
						// Configuration
						}, function(error, culw) {
							if (error) {
								console.log("Can not initialize CULW engine ",
										error);
								process.exit(3);
								return;
							}

							sp.on('data', function(data) {
								// console.log('data received: ' + data+"'");

								culw.processSerialData(data);
							});

							sp.on('close', function() {
								console.log('close received: ' + data);

								culw.close();

								xpl.close();
							});

							xpl.on("xpl:xpl-cmnd", function(message) {
								culw.processXplMessage(message);
							});
						});

					});
				} catch (x) {
					console.log(x);
				}
			});
		});

program.parse(process.argv);
