var Util = require('util');
var Events = require('events');

var fhtTempCommands = {
  "manualTemp" : 0x45,
  "comfortTemp" : 0x82,
  "economicTemp" : 0x84,
  "windowOpenTemp" : 0x8a
};

var Culw = function(serialWriter, xplWriter, configuration, callback) {

  var self = this;
  this._xplWriter = xplWriter;
  this._serialWriter = serialWriter;
  this._configuration = configuration || {};

  this._fhtTemp = {};
  this._fhtPeriodsByHouseCode = {};
  this._fhtPeriodsTimerId = {};
  this._fhtWarnings = {};
  this._fs20Maximum = {};

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
  console.log("EM: device  '" + device + "' cumulated=" + cumulatedValue +
      " value=" + currentValue + " maximum=" + maximumValue);

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

  if (this._fs20Maximum[device] != maximumValue) {
    this._fs20Maximum[device] = maximumValue;

    this._xplWriter({
      device : device,
      type : "maximum",
      current : maximumValue
    });
  }
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
  var self = this;

  switch (code) {
  case 0x00:
    val = Math.floor((val / 255) * 100 + 0.5);

    switch (status) {
    case 0x2a:
    case 0x3a:
      console.log("FHT: lime protection");
      return;
    case 0xaa:
    case 0xba:
      console.log("FHT: lime protection value " + val);
      return;
    case 0xa0:
    case 0xb0:
      console.log("FHT: sync in the summer");
      return;
    }

    switch (status & 0xf) {
    case 0:
      console
          .log("FHT: Sync now " + val + " for houseCode '" + houseCode + "'");
      return;

    case 1:
      console.log("FHT: Valve 100% for houseCode '" + houseCode + "'");
      this._xplWriter({
        device : "fht " + houseCode,
        type : "valve",
        current : 100,
        units : "%"
      });
      return;

    case 2:
      console.log("FHT: Valve 0% for houseCode '" + houseCode + "'");
      this._xplWriter({
        device : "fht " + houseCode,
        type : "valve",
        current : 0,
        units : "%"
      });
      return;

    case 6:
      if (val > 100) {
        val = 100;
      }

      console.log("FHT: Valve " + val + "% for houseCode '" + houseCode +
          "' (parameters=" + parameters + ")");
      this._xplWriter({
        device : "fht " + houseCode,
        type : "valve",
        current : val,
        units : "%"
      });
      return;

    case 8:
      if (val > 128) {
        val = 128 - val;
      }
      console.log("FHT: Offset of houseCode '" + houseCode + "' : " + val);
      return;
    }

    return;

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
    if (this._xplProcessProgram(houseCode, code - 0x14, val)) {
      var ts = this._fhtPeriodsTimerId;
      if (ts[houseCode]) {
        clearTimeout(ts[houseCode]);
      }

      ts[houseCode] = setTimeout(function() {
        delete ts[houseCode];

        self._updateProgram(houseCode);
      }, 1000 * 5);
    }
    return;

  case 0x3e:
    console.log("FHT: Automatic mode of houseCode '" + houseCode + "' : " +
        (val == 1)
        ? "Manual" : "Auto");
    this._xplWriter({
      device : "fht " + houseCode,
      type : "mode",
      current : (val == 1)
          ? "manual" : "auto"
    });
    return;

  case 0x41:
    val /= 2;
    console.log("FHT: Desired temperature of houseCode '" + houseCode + "' : " +
        val + "°");

    this._xplWriter({
      device : "fht " + houseCode,
      type : "desiredTemp",
      current : val,
      units : "c"
    });
    return;

  case 0x42:
    // console.log("FHT: measured-low " + val);
    this._fhtTemp[houseCode] = val;
    break;

  case 0x43:
    var low = this._fhtTemp[houseCode];
    if (low === undefined) {
      break;
    }
    delete this._fhtTemp[houseCode];

    val = (val * 256 + low) / 10;
    console.log("FHT: Mesured temperature of houseCode '" + houseCode + "' : " +
        val + "°");

    this._xplWriter({
      device : "fht " + houseCode,
      type : "temp",
      current : val,
      units : "c"
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

    console.log("FHT: Warnings for houseCode '" + houseCode + "' : 0x" +
        val.toString(16) + " oldMask=0x" + mask.toString(16) + " diff=0x" +
        (mask ^ val).toString(16));

    if (mask != val || ws === undefined) {
      var diff = (ws !== undefined)
          ? (mask ^ val) : 0x33;
      warnings[houseCode] = val;

      if (diff & 0x01) {
        this._xplWriter({
          device : "fht " + houseCode,
          type : "battery",
          current : (val & 0x01)
              ? 0 : 100,
          units : "%"
        });
      }
      if (diff & 0x02) {
        this._xplWriter({
          device : "fht " + houseCode,
          type : "temperatureLow",
          current : (val & 0x02)
              ? "on" : "off"
        });
      }
      if (diff & 0x10) {
        this._xplWriter({
          device : "fht " + houseCode,
          type : "windowSensorError",
          current : (val & 0x10)
              ? "on" : "off"
        });
      }
      if (diff & 0x20) {
        this._xplWriter({
          device : "fht " + houseCode,
          type : "windowOpen",
          current : (val & 0x20)
              ? "on" : "off"
        });
      }
    }
    return;

  case 0x45:
    val /= 2;
    console
        .log("FHT: Manual temperature of '" + houseCode + "' : " + val + "°");

    this._xplWriter({
      device : "fht " + houseCode,
      type : "manualTemp",
      current : val,
      units : "c"
    });
    return;
  case 0x82:
    val /= 2;
    console.log("FHT: Day temperature of '" + houseCode + "' : " + val + "°");
    this._xplWriter({
      device : "fht " + houseCode,
      type : "comfortTemp",
      current : val,
      unit : "c"
    });
    return;
  case 0x84:
    val /= 2;
    console.log("FHT: Night temperature of '" + houseCode + "' : " + val + "°");
    this._xplWriter({
      device : "fht " + houseCode,
      type : "economicTemp",
      current : val,
      units : "c"
    });
    return;
  case 0x8a:
    val /= 2;
    console.log("FHT: Window Open temperature of '" + houseCode + "' : " + val +
        "°");
    this._xplWriter({
      device : "fht " + houseCode,
      type : "windowOpenTemp",
      current : val,
      units : "c"
    });
    return;
  }

  console.log("FHT: Unsupported command: houseCode='" + houseCode +
      "' command=0x" + code.toString(16) + " val=" + val + "  parameters=" +
      parameters);
};

Culw.prototype._xplProcessProgram = function(houseCode, index, parameter) {
  var dayIndex = ((Math.floor(index / 4) + 1) % 7);

  console.log("FHT: process program for houseCode '" + houseCode + "' index=" +
      index + " parameter=" + parameter);

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

  var periodIndex = index % 4;

  if (parameter < 0) {
    return false;
  }

  if (parameter >= 0x90) {
    // Delete day configuration
    if (!periodsDay.length) {
      // nothing to delete
      return false;
    }

    if (!periodIndex) {
      // clear all periods

      periodsWeek[dayIndex] = [];
      return true;
    }

    // clear second periodIndex

    if (periodsWeek.length == 1) {
      // Only one period !
      return false;
    }

    // Keep the first period

    periodsWeek[dayIndex] = periodsDay.slice(0, 2);
    return true;
  }

  if (periodsDay[periodIndex] == parameter * 10) {
    return false;
  }

  periodsDay[periodIndex] = parameter * 10;
  // console.log("FHT: set index="+periodIndex+" parameter="+(parameter*10));
  return true;
};

Culw.prototype._updateProgram = function(houseCode) {

  console.log("FHT: update program for houseCode '" + houseCode + "'");

  var ps = this._fhtPeriodsByHouseCode[houseCode];
  if (!ps) {
    return;
  }

  var days = [ "sun", "mon", "tue", "wed", "thu", "fri", "sat" ];

  var program = "";
  function add(v) {
    var h = Math.floor(v / 60);
    var m = v % 60;
    if (h < 10) {
      program += "0";
    }
    program += String(h) + ":";
    if (m < 10) {
      program += "0";
    }
    program += String(m);
  }

  for (var i = 0; i < days.length; i++) {
    var p = ps[i];
    if (!p || !p.length) {
      continue;
    }

    if (program.length) {
      program += " ";
    }
    program += days[i] + "=";

    for (var j = 0; j < p.length;) {
      if (j > 0) {
        program += ",";
      }

      var start = p[j++];
      var end = p[j++];

      // console.log("start="+start+" end="+end);

      if (!start || !end) {
        break;
      }
      add(start);

      program += "-";

      add(end);
    }

  }

  console.log("FHT: update program for houseCode '" + houseCode + "' => " +
      program);

  this._xplWriter({
    device : "fht " + houseCode,
    type : "program",
    current : program
  });

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
      type : "state",
      current : "on"
    });
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
    console.log("FS20: Dim of '" + houseCode + "' device '" + device + "' : " +
        p + "%");
    this._xplWriter({
      device : "fs20 " + houseCode,
      type : "dim",
      current : p,
      units : "%"
    });

    return;
  }
  console.log("FS20: Unsupported command : House code=" + houseCode +
      " device=" + device + " command=0x" + command.toString(16) +
      " extension=" + extension + "  parameters=" + parameters);

};

Culw.prototype.processXplMessage = function(message) {

  if (message.bodyName != "control.basic") {
    console.log("XPL: Unsupported bodyName=", message.bodyName, " body=",
        message.body);
    return;
  }

  var body = message.body;
  var command = body.command;
  if (!command) {
    console.log("XPL: Unknown command name  body=", message.body);
    return;
  }

  var device = body.device;
  if (!device) {
    console.log("XPL: Unknown device body=", message.body);
    return;
  }

  if (device.indexOf("fs20 ") == 0) {
    return Culw.prototype._fs20Command(body);
  }

  if (device.indexOf("fht ") == 0) {
    return Culw.prototype._fhtCommand(body);
  }

  /*
   * if (device.indexOf("em ")==0) { return Culw.prototype._emCommand(body); }
   */

  console.log("XPL: Unknown device type=", message.body);
};

Culw.prototype._fhtCommand = function(body) {
  var command = body.command;
  var origin = this._configuration.fs20commandOrigin || "77";

  var houseCode = device.substring(device.indexOf(' ') + 1);
  houseCode = ("0000" + houseCode).substring(houseCode.length);

  var buf = "T" + houseCode.substring(0, 4);

  if (fhtTempCommands[command]) {
    var current = 0;
    if (body.current) {
      current = Math.floor(parseInt(body.current, 10) * 2);
    }

    if (current < 5.5 || current > 30.5) {
      console.log("FHT-Command : Invalid current command body=", body);
      return false;
    }

    buf += fhtTempCommands[command] + origin + ((current < 10)
        ? "0" : "") + current + "\n";

    // TODO call T03 to get the size of remaining buffer

    console.log("FHT-Command: set temperature '" + command + "' current='" +
        current + "' => " + buf);
    this._serialWriter(buf.toUpperCase());
    return true;
  }

  switch (command) {
  case "mode":
    if (!body.current) {
      console.log("FHT-Command : Invalid current command body=", body);
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
      console.log("FHT-Command : Invalid manual current body=", body);
      return false;
    }

    buf += "3e" + origin + "0" + manual;

    // TODO call T03 to get the size of remaining buffer

    console.log("FHT-Command: set mode '" + command + "' current='" + current +
        "' => " + buf);
    this._serialWriter(buf.toUpperCase());
    break;
  }
  console.log("FHT-Command : Unknown command body=", body);
  return false;
};

Culw.prototype._fs20Command = function(body) {
  console.log("FS20-Command : Unknown command body=", body);
};

Culw.prototype.close = function() {

};
