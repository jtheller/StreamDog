const fs = require('fs'),
  path = require('path'),
  LOG_DIRECTORY = path.join(__dirname, '/log'),
  LOG_FILE = LOG_DIRECTORY + '/log.txt'
;

// Create logging folder
fs.existsSync(LOG_DIRECTORY) || fs.mkdirSync(LOG_DIRECTORY);

const stream = fs.createWriteStream(LOG_FILE, { flags: "a" });

// Declare multiLog function.
global.multiLog = function () {
  const stuff = [`${new Date().toUTCString()}:`, ...arguments];
  console.log(...stuff);
  let log = [];

  for (let item of stuff) {
    let stringified;
    if (typeof item === "object") {
      try {
        stringified = JSON.stringify(item, null, 2);
      }
      catch (e) {
        stringified = e;
      }
    }
    log.push(stringified || item);
  }
  log.push("\n");
  stream.write(log.join(" "), "UTF-8");
};

module.exports = {
  noCrash: () => {
    // Non-serviced node app temporary error handling.
    process.on('uncaughtException', err => {
      multiLog(err);
      multiLog("Handled suppose to crash exception, review source code.");
    });
  },
  clear: () => console.clear()
};