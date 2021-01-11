const fs = require("fs");
const axios = require("axios");
const { spawn } = require("child_process");
const path = require("path");
const puppeteer = require("puppeteer");
const log = require("./log");

const {
  channelId,
  scanInterval,
  apiKey,
  relevanceLanguage,
  regionCode,
  outputDir,
  useHtml
} = config = JSON.parse(fs.readFileSync(__dirname + "/config.json"));

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

const startStreamRip = async (url, quality, outdir, filename) => new Promise((resolve, reject) => {
  const streamlink = spawn("streamlink", [url, quality, `-o ${normalizeName(filename)}`, "--force"], { cwd: outdir });

  streamlink.stdout.on("data", (data) => multiLog("streamlink:", data.toString()));

  streamlink.stderr.on("data", reject);

  streamlink.on("error", reject);

  streamlink.on("exit", resolve);
});

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
    const outdir = path.resolve(outputDir);
    return [url, quality, outdir, `${title || videoId}.ts`];
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

    const titleContainerElm = await page.$(".title");
    const titleElm = titleContainerElm && await titleContainerElm.$("yt-formatted-string");
    const title = titleElm && await page.evaluate(title => title.innerHTML, titleElm);
    
    if (title) {
      multiLog("Found stream", title);
      const quality = "best";
      const outdir = path.resolve(outputDir);
      return [url, quality, outdir, `${title}.ts`];
    }
    return noStream();
  })
  .finally(() => Browser && Browser.close());
}

const getChannelLiveStatus = () => (useHtml ? getChannelLiveStatusViaHtml() : getChannelLiveStatusViaApi())
  .then(args => args && startStreamRip(...args))
  .catch(err => multiLog("streamlink error", err));

const startScanInterval = async () => {
  await getChannelLiveStatus();
  await asyncPause(scanInterval);
  return startScanInterval();
}

if (scanInterval) return startScanInterval();
return getChannelLiveStatus();