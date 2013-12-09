var Util = require('util');
var Events = require('events');

var Culw = function(serialWriter, xplWriter, configuration, callback) {

	var self = this;
	this._xplWriter = xplWriter;

	serialWriter("\n\nV\n", function(error) {
		if (error) {
			return callback(error, self);
		}

		serialWriter("\nX61\n\n", function(error) {
			if (error) {
				return callback(error, self);
			}

			callback(null, self);
		});
	});
};

Util.inherits(Culw, Events.EventEmitter);
module.exports = Culw;

Culw.prototype.processSerialData = function(data) {
	data = data.trim();
	if (data.length < 2) {
		return;
	}

	var ch = data[0];
	var params = data.substring(1);
	switch (ch) {

	case "V":
		// Version
		console.log("Version of CULW is " + params);
		return;
	}

	var fct = this["processCommand_" + ch];
	// console.log("fct ",fct);
	if (fct) {
		try {
			return fct.call(this, params);
		} catch (x) {
			console.log("Error while parsing " + params, x);
		}
	}

	console.log("Unsupported command '" + data + "'");
};

Culw.prototype.processCommand_E = function(parameters) {
	// EM COMMAND

	// 03090000000000000034
	// 03090118001800180034
	// 0309021B0003001B0034

	// ttaacc111122223333
	if (parameters.length < 18) {
		console.log("EM: unsupported command " + parameters);
		return;
	}

	console.log("EM: command " + parameters);

	var type = parameters.substring(0, 2);
	var address = parameters.substring(2, 4);
	var counter = parameters.substring(4, 6);
	var sCumulatedValue = parameters.substring(8, 10)
			+ parameters.substring(6, 8);
	var sCurrentValue = parameters.substring(12, 14)
			+ parameters.substring(10, 12);
	var sMaximumValue = parameters.substring(16, 18)
			+ parameters.substring(14, 16);

	var cumulatedValue = parseInt(sCumulatedValue, 16);
	var currentValue = parseInt(sCurrentValue, 16);
	var maximumValue = parseInt(sMaximumValue, 16);

	switch(type) {
	case "01":
		type = "EM-1000";
		break;

	case "02":
		type = "EM-100";
		break;

	case "03":
		type = "1000GZ";
		break;
	}
	var device = "em " + type + " " + address;
	console.log("EM: device  '" + device + "' cumulated=" + cumulatedValue
			+ " value=" + currentValue + " maximum=" + maximumValue);

	this._xplWriter({
		device : device,
		type : "cumulated",
		current : cumulatedValue
	});
	this._xplWriter({
		device : device,
		type : "current",
		current : currentValue
	});
	this._xplWriter({
		device : device,
		type : "maximum",
		current : maximumValue
	});
};

Culw.prototype.processCommand_T = function(parameters) {
	// FHT COMMAND

	// Format THHHHCCOOAA THHHHCCAA[CCAA[CCAA...]]

	if (parameters.length < 8) {
		console.log("Invalid T format '" + parameters + "'");
		return;
	}

	var houseCode = parameters.substring(0, 4);
	var code = parseInt(parameters.substring(4, 6), 16);
	var status = parseInt(parameters.substring(6, 8), 16);
	var val = parseInt(parameters.substring(8, 10), 16);

	switch (code) {
	case 0x00:
		val = Math.floor((val / 255) * 100 + 0.5);

		switch (status & 0xf) {
		case 0:
			console.log("FHT: Sync now " + val);
			break;
		case 1:
			console.log("FHT: Valve 100% for  '" + houseCode + "'");
			this._xplWriter({
				device : "fht " + houseCode,
				type : "valve",
				current : 100,
				units : "%"
			});
			break;
		case 2:
			console.log("FHT: Valve 0% for  '" + houseCode + "'");
			this._xplWriter({
				device : "fht " + houseCode,
				type : "valve",
				current : 0,
				units : "%"
			});
			break;
		case 6:
			if (val > 100) {
				val = 100;
			}

			console.log("FHT: Valve " + val + "% for  '" + houseCode
					+ "' (parameters=" + parameters + ")");
			this._xplWriter({
				device : "fht " + houseCode,
				type : "valve",
				current : val,
				units : "%"
			});
			break;
		case 8:
			console.log("FHT: Offset " + val);
			break;

		}
		break;
	case 0x14:
	case 0x15:
	case 0x16:
	case 0x17:
	case 0x18:
	case 0x19:
	case 0x1A:
	case 0x1B:
	case 0x1C:
	case 0x1D:
	case 0x1E:
	case 0x1F:
	case 0x20:
	case 0x21:
	case 0x22:
	case 0x23:
	case 0x24:
	case 0x25:
	case 0x26:
	case 0x27:
	case 0x28:
	case 0x29:
	case 0x2A:
	case 0x2B:
	case 0x2C:
	case 0x2D:
	case 0x2E:
	case 0x2F:
		this._xplProcessProgram(houseCode, cdoe - 0x14, val);
		break;

	case 0x3e:
		console.log("FHT: Automatic mode of '" + houseCode + "' : "
				+ (val == 1) ? "Manual" : "Auto");
		this._xplWriter({
			device : "fht " + houseCode,
			type : "mode",
			current : (val == 1) ? "manual" : "auto"
		});
		break;
	case 0x41:
		val /= 2;
		console.log("FHT: Desired temperature of '" + houseCode + "' : " + val
				+ "°");

		this._xplWriter({
			device : "fht " + houseCode,
			type : "desiredTemp",
			current : val,
			units : "c"
		});
		break;
	case 0x42:
		console.log("FHT: measured-low " + val);
		if (!this._fhtTemp) {
			this._fhtTemp = {};
		}
		this._fhtTemp[houseCode] = val;
		break;
	case 0x43:
		if (!this._fhtTemp) {
			break;
		}
		var low = this._fhtTemp[houseCode];
		if (low === undefined) {
			break;
		}
		delete this._fhtTemp[houseCode];

		val = (val * 256 + low) / 10;
		console.log("FHT: Mesured temperature of '" + houseCode + "' : " + val
				+ "°");

		this._xplWriter({
			device : "fht " + houseCode,
			type : "temp",
			current : val,
			units : "c"
		});
		break;
	case 0x44:
		val &= 0x62;
		console.log("FHT: Warnings of '" + houseCode + "' : 0x"
				+ val.toString(16));

		var warnings = this._fhtWarnings;
		if (!warnings) {
			warnings = {};
			this._fhtWarnings = warnings;
		}
		var mask = warnings[houseCode];
		if (mask != val) {
			var diff = mask ^ val;
			warnings[houseCode] = val;

			if (diff & 0x01) {
				this._xplWriter({
					device : "fht " + houseCode,
					type : "battery",
					current : (val & 0x01) ? 0 : 100,
					units : "%"
				});
			}
			if (diff & 0x02) {
				this._xplWriter({
					device : "fht " + houseCode,
					type : "temperatureLow",
					current : (val & 0x02) ? "on" : "off"
				});
			}
			if (diff & 0x20) {
				this._xplWriter({
					device : "fht " + houseCode,
					type : "windowSensorError",
					current : (val & 0x02) ? "on" : "off"
				});
			}
			if (diff & 0x40) {
				this._xplWriter({
					device : "fht " + houseCode,
					type : "windowOpen",
					current : (val & 0x02) ? "on" : "off"
				});
			}

		}
		break;
	case 0x45:
		val /= 2;
		console.log("FHT: Manual temperature of '" + houseCode + "' : " + val
				+ "°");

		this._xplWriter({
			device : "fht " + houseCode,
			type : "manualTemp",
			current : val,
			units : "c"
		});
		break;
	case 0x82:
		val /= 2;
		console.log("FHT: Day temperature of '" + houseCode + "' : " + val
				+ "°");
		this._xplWriter({
			device : "fht " + houseCode,
			type : "comfortTemp",
			current : val,
			unit : "c"
		});
		break;
	case 0x84:
		val /= 2;
		console.log("FHT: Night temperature of '" + houseCode + "' : " + val
				+ "°");
		this._xplWriter({
			device : "fht " + houseCode,
			type : "economicTemp",
			current : val,
			units : "c"
		});
		break;
	case 0x8a:
		val /= 2;
		console.log("FHT: Window Open temperature of '" + houseCode + "' : "
				+ val + "°");
		this._xplWriter({
			device : "fht " + houseCode,
			type : "windowOpenTemp",
			current : val,
			units : "c"
		});
		break;

	default:
		console.log("FHT: Unsupported command: House code=" + houseCode
				+ " command=0x" + code.toString(16) + " val=" + val
				+ "  parameters=" + parameters);
		break;
	}

};

Culw.prototype._xplProcessProgram = function(houseCode, index, parameter) {
	var dayIndex = ((Math.floor(index / 4) + 1) % 7);

};

Culw.prototype.processCommand_F = function(parameters) {
	// FS20 COMMAND

	// Format hhhhaacc or hhhhaaccee

	if (parameters.length < 8) {
		console.log("FS20: Invalid format '" + parameters + "'");
		return;
	}

	var houseCode = parameters.substring(0, 4);
	var device = parameters.substring(4, 6);
	var command = parseInt(parameters.substring(6, 8), 16);
	var extension = parameters.substring(10, 12);

	if (command == 0x3a) {
		console.log("FS20: ON of '" + houseCode + "' device '" + device + "'");
		this._xplWriter({
			device : "fs20 " + houseCode,
			type : "dim",
			current : 100,
			units : "%"
		});

		return;
	}
	if (command <= 0x10) {
		var p = Math.floor(command / 0x10 * 100);
		console.log("FS20: Dim of '" + houseCode + "' device '" + device
				+ "' : " + p + "%");
		this._xplWriter({
			device : "fs20 " + houseCode,
			type : "dim",
			current : p,
			units : "%"
		});

		return;
	}
	console.log("FS20: Unsupported command : House code=" + houseCode
			+ " device=" + device + " command=0x" + command.toString(16)
			+ " extension=" + extension + "  parameters=" + parameters);

};

Culw.prototype.processXplMessage = function(data) {

};

Culw.prototype.close = function() {

};
