var Xpl = require("xpl-api");
var program = require('commander');
var serialport = require("serialport");
var process = require('process');
var CulwSerial = require('./lib/culw-serial');
var os = require('os');

program.option("-s, --xplSource <name>", "Source name for XPL messages")
		.option("-l, --listSerialPorts", "List known serial ports").option(
				"-i, --serialPort <path>", "Serial device path").parse(
				process.argv);

if (program.listSerialPorts) {
	console.log("List serial ports:");
	serialport.list(function(err, ports) {
		if (err) {
			console.log("End of list");

			process.exit(0);
		}
		ports.forEach(function(port) {
			console.log("Port name='" + port.comName + "' pnpId='" + port.pnpId
					+ "' manufacturer='" + port.manufacturer + "'");
		});
		console.log("End of list");

	});

} else {

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
				console.log("Can not open serial device ", error);
				process.exit(1);
				return;
			}
			console.log("Serial device '" + program.serialPort + "' opened.");

			var xpl = new Xpl({
				source : program.xplSource || "culw." + os.hostname(),
				log: false
			});
	
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
					//console.log("Write '" + data + "'");
					sp.write(data, callback);
					
				}, function(body, callback) {
					xpl.sendXplTrig(body, callback);
					
				}, {
				// Configuration
				}, function(error, culw) {
					if (error) {
						console.log("Can not initialize CULW engine ", error);
						process.exit(3);
						return;
					}

					sp.on('data', function(data) {
						//console.log('data received: ' + data+"'");

						culw.processSerialData(data);
					});

					sp.on('close', function() {
						console.log('close received: ' + data);

						culw.close();

						xpl.close();
					});

					xpl.on("message", function(message) {
						culw.processXplMessage(message);
					});
				});

			});
		} catch (x) {
			console.log(x);
		}
	});
}