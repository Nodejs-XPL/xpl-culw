/*jslint node: true, vars: true, nomen: true, esversion: 6 */
'use strict';

const Util = require('util');
const Events = require('events');
const debug = require('debug')('xpl-culw:serial');

const fhtTempCommands = {
	"manualTemp": 0x45,
	"comfortTemp": 0x82,
	"economicTemp": 0x84,
	"windowOpenTemp": 0x8a
};

class Culw extends Events.EventEmitter {
	constructor(serialWriter, xplWriter, configuration, callback) {
		super();

		this._xplWriter = xplWriter;
		this._serialWriter = serialWriter;
		this._configuration = configuration || {};

		this._fhtTemp = {};
		this._fhtPeriodsByHouseCode = {};
		this._fhtPeriodsTimerId = {};
		this._fhtWarnings = {};
		this._fs20Maximum = {};
		this._waitVersion = Date.now();

		callback = callback || (() => {
			});

		debug("constructor", "Sending CR+CR");

		serialWriter("\n\nV\n", (error) => {
			if (error) {
				return callback(error, this);
			}

			debug("constructor", "Sending X61 command");

			serialWriter("\nX61\n\n", (error) => {
				if (error) {
					return callback(error, this);
				}

				callback(null, this);
			});
		});
	}

	processSerialData(data) {
		debug("processSerialData", "ProcessSerialData=", data);
		data = data.trim();
		if (data.length < 2) {
			return;
		}

		var ch = data[0];
		var params = data.substring(1);
		switch (ch) {

			case "V":
				// Version
				debug("processSerialData", "Version of CULW is " + params);
				this._waitVersion = false;
				return;
		}

		if (this._waitVersion) {
			debug("processSerialData", "Waiting for CULW version ! Ignore command '" + data + "'");

			var now = Date.now();
			if (now - this._waitVersion < 5000) {
				return;
			}
			this._waitVersion = now;

			this._serialWriter("\n\nV\n", (error) => {
				if (error) {
					debug("processSerialData", "Request of Version throws error ", error);
				}
			});

			return;
		}

		var fct = this["processCommand_" + ch];
		// debug("fct ",fct);
		if (fct) {
			try {
				return fct.call(this, params);

			} catch (x) {
				debug("processSerialData", "Error while parsing " + params, x);
			}
		}

		debug("processSerialData", "Unsupported command '" + data + "'");
	}

	processCommand_E(parameters) {
		// EM COMMAND

		// 03090000000000000034
		// 03090118001800180034
		// 0309021B0003001B0034

		// ttaacc111122223333
		if (parameters.length < 18) {
			debug("EM: unsupported command " + parameters);
			return;
		}

		debug("EM: command", parameters);

		var type = parameters.substring(0, 2);
		var address = parameters.substring(2, 4);
		var counter = parameters.substring(4, 6);
		var sCumulatedValue = parameters.substring(8, 10) +
			parameters.substring(6, 8);
		var sCurrentValue = parameters.substring(12, 14) +
			parameters.substring(10, 12);
		var sMaximumValue = parameters.substring(16, 18) +
			parameters.substring(14, 16);

		var cumulatedValue = parseInt(sCumulatedValue, 16);
		var currentValue = parseInt(sCurrentValue, 16);
		var maximumValue = parseInt(sMaximumValue, 16);

		switch (type) {
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
		debug("EM: device=", device, "cumulated=", cumulatedValue, "value=",
			currentValue, "maximum=", maximumValue);

		this._xplWriter({
			device: device,
			type: "cumulated",
			current: cumulatedValue
		});
		this._xplWriter({
			device: device,
			type: "current",
			current: currentValue
		});

		if (this._fs20Maximum[device] != maximumValue) {
			this._fs20Maximum[device] = maximumValue;

			this._xplWriter({
				device: device,
				type: "maximum",
				current: maximumValue
			});
		}
	}

	processCommand_T(parameters) {
		// FHT COMMAND

		// Format THHHHCCOOAA THHHHCCAA[CCAA[CCAA...]]

		if (parameters.length < 8) {
			debug("processCommand_T", "Invalid T format", parameters);
			return;
		}

		var x1 = parseInt(parameters.substring(0, 2), 16);
		var x2 = parseInt(parameters.substring(2, 4), 16);

		var houseCode;
		if (x1 < 100 && x2 < 100) {
			houseCode = ((x1 < 10) ? "0" : "") + x1 + ((x2 < 10) ? "0" : "") + x2;
		} else {
			houseCode = "x" + parameters.substring(0, 4);
		}

		var code = parseInt(parameters.substring(4, 6), 16);
		var status = parseInt(parameters.substring(6, 8), 16);
		var val = parseInt(parameters.substring(8, 10), 16);

		switch (code) {
			case 0x00:
				val = Math.floor((val / 255) * 100 + 0.5);

				switch (status) {
					case 0x2a:
					case 0x3a:
						debug("processCommand_T", "FHT: lime protection for houseCode=", houseCode, "val=", val);
						return;
					case 0xaa:
					case 0xba:
						debug("processCommand_T", "FHT: lime protection for houseCode=", houseCode, "val=", val);
						return;
					case 0xa0:
					case 0xb0:
						debug("processCommand_T", "FHT: sync in the summer for houseCode=", houseCode);
						return;
				}

				switch (status & 0xf) {
					case 0:
						debug("processCommand_T", "FHT: Sync now", val, "for houseCode=", houseCode);
						return;

					case 1:
						debug("processCommand_T", "FHT: Valve 100% for houseCode=", houseCode);
						this._xplWriter({
							device: "fht " + houseCode,
							type: "valve",
							current: 100,
							units: "%"
						});
						return;

					case 2:
						debug("processCommand_T", "FHT: Valve 0% for houseCode=", houseCode);
						this._xplWriter({
							device: "fht " + houseCode,
							type: "valve",
							current: 0,
							units: "%"
						});
						return;

					case 6:
						if (val > 100) {
							val = 100;
						}

						debug("processCommand_T", "FHT: Valve", val, "% for houseCode=", houseCode, "(parameters=",
							parameters, ")");
						this._xplWriter({
							device: "fht " + houseCode,
							type: "valve",
							current: val,
							units: "%"
						});
						return;

					case 8:
						if (val > 128) {
							val = 128 - val;
						}
						debug("processCommand_T", "FHT: Offset of houseCode=", houseCode, " => ", val);
						return;
				}

				return;

			case 0x01: // syn !
				debug("processCommand_T", "FHT: Housecode", houseCode, "requets sync !");
				return;

			case 0x14: // sun
			case 0x15:
			case 0x16:
			case 0x17:
			case 0x18: // mon
			case 0x19:
			case 0x1A:
			case 0x1B:
			case 0x1C: // tue
			case 0x1D:
			case 0x1E:
			case 0x1F:
			case 0x20: // wed
			case 0x21:
			case 0x22:
			case 0x23:
			case 0x24: // thu
			case 0x25:
			case 0x26:
			case 0x27:
			case 0x28: // fri
			case 0x29:
			case 0x2A:
			case 0x2B:
			case 0x2C: // sat
			case 0x2D:
			case 0x2E:
			case 0x2F:
				if (this._xplProcessProgram(houseCode, code - 0x14, val)) {
					var ts = this._fhtPeriodsTimerId;
					if (ts[houseCode]) {
						clearTimeout(ts[houseCode]);
					}

					ts[houseCode] = setTimeout(() => {
						delete ts[houseCode];

						this._updateProgram(houseCode);
					}, 1000 * 20);
				}
				return;

			case 0x3e:
				debug("processCommand_T", "FHT: Automatic mode of houseCode=", houseCode, ":",
					((val == 1) ? "Manual" : "Auto"));
				this._xplWriter({
					device: "fht " + houseCode,
					type: "mode",
					current: (val == 1) ? "manual" : "auto"
				});
				return;

			case 0x41:
				val /= 2;
				debug("processCommand_T", "FHT: Desired temperature of houseCode=", houseCode, ":", val, "°");

				this._xplWriter({
					device: "fht " + houseCode,
					type: "desiredTemp",
					current: val,
					units: "c"
				});
				return;

			case 0x42:
				// debug("FHT: measured-low " + val);
				this._fhtTemp[houseCode] = val;
				return;

			case 0x43:
				var low = this._fhtTemp[houseCode];
				if (low === undefined) {
					break;
				}
				delete this._fhtTemp[houseCode];

				val = (val * 256 + low) / 10;
				debug("processCommand_T", "FHT: Mesured temperature of houseCode=", houseCode, ":", val, "°");

				this._xplWriter({
					device: "fht " + houseCode,
					type: "temp",
					current: val,
					units: "c"
				});
				return;

			case 0x44:
				val &= 0x33;
				var warnings = this._fhtWarnings;
				if (!warnings) {
					warnings = {};
					this._fhtWarnings = warnings;
				}
				var ws = warnings[houseCode];
				var mask = ws || 0;

				debug("processCommand_T", "FHT: Warnings for houseCode=", houseCode, ": 0x" + val.toString(16),
					"oldMask=0x" + mask.toString(16), "diff=0x" + (mask ^ val).toString(16));

				if (mask != val || ws === undefined) {
					var diff = (ws !== undefined) ? (mask ^ val) : 0x33;
					// warnings[houseCode] = val; // Always send states (don't record old
					// value)

					if (diff & 0x01) {
						this._xplWriter({
							device: "fht " + houseCode,
							type: "battery",
							current: (val & 0x01) ? 0 : 100,
							units: "%"
						});
					}
					if (diff & 0x02) {
						this._xplWriter({
							device: "fht " + houseCode,
							type: "temperatureLow",
							current: (val & 0x02) ? "on" : "off"
						});
					}
					if (diff & 0x10) {
						this._xplWriter({
							device: "fht " + houseCode,
							type: "windowSensorError",
							current: (val & 0x10) ? "on" : "off"
						});
					}
					if (diff & 0x20) {
						this._xplWriter({
							device: "fht " + houseCode,
							type: "windowOpen",
							current: (val & 0x20) ? "on" : "off"
						});
					}
				}
				return;

			case 0x45:
				val /= 2;
				debug("processCommand_T", "FHT: Manual temperature of houseCode=", houseCode, ":", val, "°");

				this._xplWriter({
					device: "fht " + houseCode,
					type: "manualTemp",
					current: val,
					units: "c"
				});
				return;

			case 0x82:
				val /= 2;
				debug("processCommand_T", "FHT: Comfort temperature of houseCode=", houseCode, ":", val, "°");
				this._xplWriter({
					device: "fht " + houseCode,
					type: "comfortTemp",
					current: val,
					unit: "c"
				});
				return;

			case 0x84:
				val /= 2;
				debug("processCommand_T", "FHT: Economic temperature of", houseCode, ":", val, "°");
				this._xplWriter({
					device: "fht " + houseCode,
					type: "economicTemp",
					current: val,
					units: "c"
				});
				return;

			case 0x8a:
				val /= 2;
				debug("processCommand_T", "FHT: Window Open temperature of houseCode=", houseCode, ":", val,
					"°");
				this._xplWriter({
					device: "fht " + houseCode,
					type: "windowOpenTemp",
					current: val,
					units: "c"
				});
				return;
		}

		debug("processCommand_T", "FHT: Unsupported command: houseCode=", houseCode, "command=0x" +
			code.toString(16), " val=", val, "  parameters=", parameters);
	}

	_xplProcessProgram(houseCode, index, parameter) {
		var dayIndex = ((Math.floor(index / 4) + 1) % 7);
		var periodIndex = index % 4;

		debug("_xplProcessProgram", "FHT: process program for houseCode=", houseCode, " index=", index,
			"dayIndex=", dayIndex, "periodIndex=", periodIndex, "parameter=",
			parameter);

		var periodsWeek = this._fhtPeriodsByHouseCode[houseCode];
		if (!periodsWeek) {
			periodsWeek = {};
			this._fhtPeriodsByHouseCode[houseCode] = periodsWeek;
		}

		var periodsDay = periodsWeek[dayIndex];
		if (!periodsDay) {
			periodsDay = [];
			periodsWeek[dayIndex] = periodsDay;
		}

		if (parameter < 0) {
			return false;
		}

		if (parameter >= 0x90) {
			// Delete day configuration

			if (periodIndex === 0 || periodIndex === 1) {
				// clear all periods

				if (!periodsDay.length) {
					// nothing to delete
					return false;
				}

				periodsWeek[dayIndex] = [];
				return true;
			}

			// clear second periodIndex

			if (periodsDay.length < 3) {
				// Only one period !
				return false;
			}

			// Keep the first period

			periodsWeek[dayIndex] = periodsDay.slice(0, 2);
			return true;
		}

		var v = parameter * 10;

		if (periodsDay[periodIndex] === v) {
			return false;
		}

		periodsDay[periodIndex] = v;
		debug("_xplProcessProgram", "FHT: set index=", periodIndex, "val=", v, " (min)");
		return true;
	}

	_updateProgram(houseCode) {

		var ps = this._fhtPeriodsByHouseCode[houseCode];
		if (!ps) {
			debug("_updateProgram", "FHT: update program for houseCode=", houseCode,
				": Nothing to update");
			return;
		}

		delete this._fhtPeriodsByHouseCode[houseCode];

		debug("_updateProgram", "FHT: update program for houseCode=", houseCode, "program=", ps);

		var days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

		var program = "";

		function add(v) {
			var h = Math.floor(v / 60);
			var m = v % 60;
			if (h < 10) {
				program += "0";
			}
			program += h + ":";
			if (m < 10) {
				program += "0";
			}
			program += m;
		}

		for (var i = 0; i < days.length; i++) {
			var p = ps[i];
			if (!p) {
				continue;
			}
			if (p.length > 0 && (p[0] === undefined || p[1] === undefined)) {
				continue;
			}
			if (p.length > 2 && (p[2] === undefined || p[3] === undefined)) {
				continue;
			}

			if (program.length) {
				program += " ";
			}
			program += days[i] + "=";

			for (var j = 0; j < p.length;) {
				if (j) {
					program += ",";
				}

				var start = p[j++];
				var end = p[j++];

				// debug("start="+start+" end="+end);

				if (!start || !end) {
					break;
				}
				add(start);

				program += "-";

				add(end);
			}

		}

		debug("_updateProgram", "FHT: update program for houseCode", houseCode, "=>", program);

		this._xplWriter({
			device: "fht " + houseCode,
			type: "program",
			current: program
		});
	}

	processCommand_F(parameters) {
		// FS20 COMMAND

		// Format hhhhaacc or hhhhaaccee

		if (parameters.length < 8) {
			debug("processCommand_F", "FS20: Invalid format", parameters);
			return;
		}

		var houseCode = parameters.substring(0, 4);
		var device = parameters.substring(4, 6);
		var command = parseInt(parameters.substring(6, 8), 16);
		var extension = parameters.substring(10, 12);

		if (command <= 0x10) {
			var p = Math.floor(command * 100 / 0x10);
			debug("processCommand_F", "FS20: Dim of houseCode=", houseCode, "device=", device, ":", p, "%");
			this._xplWriter({
				device: "fs20 " + houseCode + "/" + device,
				type: "state",
				current: "on"
			});
			this._xplWriter({
				device: "fs20 " + houseCode + "/" + device,
				type: "dim",
				current: p,
				units: "%"
			});

			return;
		}

		if (command <= 0x3a) {
			debug("processCommand_F", "FS20: ON of houseCode=", houseCode, "device=", device);
			this._xplWriter({
				device: "fs20 " + houseCode + "/" + device,
				type: "state",
				current: "on"
			});
			this._xplWriter({
				device: "fs20 " + houseCode + "/" + device,
				type: "dim",
				current: 100,
				units: "%"
			});

			return;
		}

		debug("processCommand_F", "FS20: Unsupported command : House code=", houseCode, "device=",
			device, "command=0x" + command.toString(16), +"extension=" + extension,
			"parameters=", parameters);

	}

	processXplMessage(message) {

		if (message.bodyName != "control.basic") {
			debug("processXplMessage",
				"XPL: Unsupported bodyName=", message.bodyName, "body=", message.body);
			return;
		}

		var body = message.body;
		var command = body.command;
		if (!command) {
			debug("processXplMessage",
				"XPL: Unknown command name  body=", message.body);
			return;
		}

		var device = body.device;
		if (!device) {
			debug("processXplMessage",
				"XPL: Unknown device body=", message.body);
			return;
		}

		if (device.indexOf("fs20 ") === 0) {
			return Culw.prototype._fs20Command(body);
		}

		if (device.indexOf("fht ") === 0) {
			return Culw.prototype._fhtCommand(body);
		}

		/*
		 * if (device.indexOf("em ")==0) { return Culw.prototype._emCommand(body); }
		 */

		debug("processXplMessage", "XPL: Unknown device type=", message.body);
	}

	_fhtCommand(body) {
		var command = body.command;
		var origin = this._configuration.fs20commandOrigin || "77";

		var device = body.device;
		var houseCode = device.substring(device.indexOf(' ') + 1);
		houseCode = ("0000" + houseCode).substring(houseCode.length);

		var buf = "T" + houseCode.substring(0, 4);

		if (fhtTempCommands[command]) {
			var current = 0;
			if (body.current) {
				current = Math.floor(parseInt(body.current, 10) * 2);
			}

			if (current < 5.5 || current > 30.5) {
				debug("_fhtCommand", "FHT-Command : Invalid current command body=", body);
				return false;
			}

			buf += fhtTempCommands[command] + origin + ((current < 10) ? "0" : "") +
				current + "\n";

			// TODO call T03 to get the size of remaining buffer

			debug("_fhtCommand", "FHT-Command: set temperature command=", command, "current=",
				current, "=>", buf);
			this._serialWriter(buf.toUpperCase());
			return true;
		}

		switch (command) {
			case "mode":
				if (!body.current) {
					debug("_fhtCommand", "FHT-Command : Invalid current command body=", body);
					return false;
				}

				var current = body.current;
				var manual;
				if (current == "1" || current == "01" || current == "manual") {
					manual = 1;

				} else if (current == "0" || current == "00" || current == "auto") {
					manual = 0;

				} else if (current == "2" || current == "02" || current == "holiday") {
					manual = 2;

				} else {
					debug("FHT-Command : Invalid manual current body=", body);
					return false;
				}

				buf += "3e" + origin + "0" + manual;

				// TODO call T03 to get the size of remaining buffer

				debug("FHT-Command: set mode command=", command, "current=", current, "=>",
					buf);
				this._serialWriter(buf.toUpperCase());
				break;
		}
		debug("FHT-Command : Unknown command body=", body);
		return false;
	}

	_fs20Command(body) {
		debug("FS20-Command : Unknown command body=", body);
	}

	close() {
	}
}

module.exports = Culw;