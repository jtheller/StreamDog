# StreamDog
Check or rip a channel live stream.


### Config example
```$xslt
{
    "channelId": "UChSakx6tthNdGh0qfUlzmbw",
    "scanInterval": 5000,
    "apiKey": "YOUR_YOUTUBE_DATA_API_KEY",
    "relevanceLanguage": "ja",
    "regionCode": "jp",
    "outputDir": "C:\",
    "useHtml": true
}
```

When using `useHtml`:

`[apiKey, regionCode, relevanceLanguage]` are not required. The check will be executed using puppeteer.