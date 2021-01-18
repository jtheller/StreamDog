const fs = require("fs");
const axios = require("axios");
const { spawn } = require("child_process");
const path = require("path");
const puppeteer = require("puppeteer");
const log = require("./log");
const { resolve } = require("path");

log.noCrash();
log.clear();

const configFile = __dirname + "/config.json";
const configJson = fs.existsSync(configFile) && fs.readFileSync(configFile);
if (!configJson) return multiLog("No configuration JSON present, exiting.");

const {
  channelId,
  scanInterval,
  apiKey,
  relevanceLanguage,
  regionCode,
  outputDir,
  useHtml
} = config = JSON.parse(configJson);
const outdir = path.resolve(outputDir);

multiLog(config);

if (!channelId) return multiLog("No channel ID specified, exiting.");
if (!useHtml && !apiKey) return multiLog("YouTube Data API key is required to run this application.");
if (!outputDir) return multiLog("Output directory not specified, exiting.");
if (!scanInterval) multiLog("No scanning interval specified, execution one time scan and rip.");

const asyncPause = async ms => new Promise(resolve => setTimeout(resolve, ms));
const isEmpty = obj => {
  if (!obj) return true;
  if (typeof obj === "string") return !(obj || "").trim();
  if (Array.isArray(obj)) return obj.length === 0;
  if (typeof obj === "object") {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      return obj.constructor === Object;
    } else {
      let empty = true;
      for (let key of keys) {
        if (!isEmpty(obj[key])) {
          empty = false;
          return empty;
        }
      }
      return empty;
    }
  }
};
const normalizeName = (name, isDir) => {
  name = name.replace(/\//g, "／");
  name = name.replace(/\\/g, "＼");
  name = name.replace(/:/g, "：");
  name = name.replace(/\*/g, "＊");
  name = name.replace(/\?/g, "？");
  name = name.replace(/"/g, "”");
  name = name.replace(/</g, "＜");
  name = name.replace(/>/g, "＞");
  name = name.replace(/\|/g, "｜");
  name = name.replace(/\+/g, "＋");
  isDir && (name = name.replace(/\./g, "_"));
  return name.trim();
};

const getApiUrl = () => `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}&regionCode=${regionCode}&relevanceLanguage=${relevanceLanguage}`;

const getChannelLiveUrl = () => `https://www.youtube.com/channel/${channelId}/live`;

const getVideoUrl = videoId => `https://www.youtube.com/watch?v=${videoId}`;

const startStreamRipPoll = async (args) => {
  if (isEmpty(args)) return;
  let retry = 100, interval = 2000, i = 0;
  const rip = async () => startStreamRip(args).catch(async err => {
    i++;
    if (i > retry) throw err;
    multiLog("streamlink:", err);
    multiLog(`Retrying after ${interval / 1000} second(s), tried ${i} time(s). Fail after ${retry} time(s).`);
    await asyncPause(interval);
    return rip();
  });
  return rip();
};

const startStreamRip = async ({ url, quality, outdir, filename }) => new Promise((resolve, reject) => {
  fs.existsSync(outdir) || fs.mkdirSync(outdir);

  const streamlink = spawn("streamlink", [url, quality, `-o ${normalizeName(filename).trim()}`, "--force"], { cwd: outdir });

  streamlink.stdout.on("data", data => {
    const output = data.toString();
    if ((output || "").match(/error/g)) {
      // streamlink.kill();
      return reject(output);
    }
    multiLog("streamlink:", output);
  });

  streamlink.stderr.on("data", reject);

  streamlink.on("error", reject);

  streamlink.on("exit", resolve);
});

const checkAutoRemux = () => {
  let videos = fs.existsSync(outdir) && fs.readdirSync(outdir);
  videos = videos && videos.filter(v => (v || "").match(/\.ts/g));
  if (isEmpty(videos)) return;

  multiLog(".ts videos to remux", videos);

  return new Promise((resolve, reject) => {
    const command = `$v = gci -Filter *.ts; foreach ($i in $v) { $out = $($i.name.replace(".ts", '.mp4')); ffmpeg -i $i.name -c copy $out; if (Test-Path($out)) {ri $i -Force} }`;

    const remux = spawn("powershell", ["-command", `&{${command}}`], { cwd: outdir });

    remux.stderr.on("data", data => multiLog("remux:", data.toString()));

    remux.stdout.on("data", reject);

    remux.on("error", reject);

    remux.on("exit", resolve);
  })
  .then(result => multiLog("Remux finished.", result));
};

const getChannelLiveStatusViaApi = async () => axios.get(getApiUrl())
  .then(response => {
    const result = response.data || {};
    const { items } = result;

    if (isEmpty(items)) return;
    const live = items[0];
    const { id, snippet } = live;

    if (isEmpty(id) || isEmpty(snippet)) return;
    const { videoId } = id;
    const { title } = snippet;

    multiLog("Found stream", live);
    const url = getVideoUrl(videoId);
    const quality = "best";
    const filename = `${title || videoId}.ts`;
    return { url, quality, outdir, filename };
  })
  .catch(err => {
    if (err.response && err.response.data) return multiLog("YouTube Data API error", err.response.data);
    return Promise.resolve();
  });

const getChannelLiveStatusViaHtml = async () => {
  multiLog(`Checking channel ${channelId}.`);
  const noStream = () => multiLog("No ongoing live stream.") && null;

  const url = getChannelLiveUrl();
  let Browser;
  
  return puppeteer.launch({
    headless: true
  })
  .then(async browser => {
    Browser = browser;
    const page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3980.0 Safari/537.36 Edg/80.0.355.1');
    await page.goto(url, { waitUntil: "load" });

    const chatWindowElm = await page.$("ytd-live-chat-frame");
    if (!chatWindowElm) return noStream();

    const titleElm = await page.$(".title");
    const title = titleElm && await page.evaluate(title => title.textContent, titleElm);
    
    if (title) {
      multiLog("Found stream", title);
      const quality = "best";
      const filename = `${title}.ts`;
      return { url, quality, outdir, filename };
    }
    return noStream();
  })
  .finally(() => Browser && Browser.close());
}

const getChannelLiveStatus = () => (useHtml ? getChannelLiveStatusViaHtml() : getChannelLiveStatusViaApi())
  .then(startStreamRipPoll)
  .then(checkAutoRemux)
  .catch(err => multiLog("getChannelLiveStatus error", err.toString()));

const startScanInterval = async () => {
  await getChannelLiveStatus();
  await asyncPause(scanInterval);
  return startScanInterval();
}

if (scanInterval) return startScanInterval();
return getChannelLiveStatus();