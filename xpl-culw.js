var Xpl = require("xpl-api");
var commander = require('commander');
var serialport = require("serialport");
var CulwSerial = require('./lib/culw-serial');
var os = require('os');

commander.version(require("./package.json").version).option("-s, --serialPort <path>", "Serial device path");

commander.option("--heapDump", "Enable heap dump (require heapdump)");
commander.option("--deviceAliases", "Device aliases (path or string)");

Xpl.fillCommander(commander);

commander.command('listSerialPort').description("List serial ports").action(
		function() {

			console.log("List serial ports:");
			serialport.list(function(err, ports) {
				if (err) {
					console.log("End of list");

					process.exit(0);
				}
				ports.forEach(function(port) {
					console.log("  Port name='" + port.comName + "' pnpId='" + port.pnpId + "' manufacturer='" +
							port.manufacturer + "'");
				});
				console.log("End of list");

			});
		});

commander.command('start').description("Start processing CULW datas").action(function() {
	console.log("Start");

	var deviceAliases = commander.deviceAliases;
	if (deviceAliases) {
		if (deviceAliases.indexOf('=') >= 0) {
			var ds = {};
			commander.deviceAliases = ds;

			var js = deviceAliases.split(',');
			for (var i = 0; i < js.length; i++) {
				var j = js[i].split('=');
				if (j.length === 2) {
					ds[j[0].trim()] = j[1].trim();
				}
			}

		} else {
			commander.deviceAliases = require(deviceAliases);
		}
	}

	if (!commander.serialPort) {
		switch (os.platform()) {
		case "win32":
			commander.serialPort = "COM4";
			break;
		case "linux":
			commander.serialPort = "/dev/serial/by-id/usb-busware.de_CUL868-if00";
			break;
		}

		console.log("Use default serial port : " + commander.serialPort);
	}

	var sp = new serialport.SerialPort(commander.serialPort, {
		baudrate: 9600,
		databits: 8,
		stopbits: 1,
		parity: 'none',
		rtscts: false,
		parser: serialport.parsers.readline("\n")
	});

	sp.on("open", function(error) {
		try {
			if (error) {
				console.log("Can not open serial device '" + commander.serialPort + "'", error);
				process.exit(1);
				return;
			}
			console.log("Serial device '" + commander.serialPort + "' opened.");

			if (!commander.xplSource) {
				var hostName = os.hostname();
				if (hostName.indexOf('.') > 0) {
					hostName = hostName.substring(0, hostName.indexOf('.'));
				}

				commander.xplSource = "culw." + hostName;
			}

			var xpl = new Xpl(commander);

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
					var deviceAliases = commander.deviceAliases;

					if (deviceAliases) {
						var da = deviceAliases[body.device];
						if (da) {
							body.device = da;
						}
					}

					xpl.sendXplTrig(body, callback);

				}, commander, function(error, culw) {
					if (error) {
						console.log("Can not initialize CULW engine ", error);
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

commander.parse(process.argv);

if (commander.headDump) {
	var heapdump = require("heapdump");
	console.log("***** HEAPDUMP enabled **************");
}
