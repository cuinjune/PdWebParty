////////////////////////////////////////////////////////////////////////////////
// server
////////////////////////////////////////////////////////////////////////////////
const http = require("http");
const https = require("https");
const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const PORT = process.env.PORT || 3000;

// handle data in a nice way
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// static path
const publicPath = path.resolve(`${__dirname}/public`);
const emscriptenPath = path.resolve(`${publicPath}/emscripten`);

// set your static server
app.use(express.static(publicPath));
app.use(express.static(emscriptenPath));

// views
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views/index.html"));
});

// api
app.get("/api/patch", async (req, res) => {
  const url = req.query.url;
  let client = http;
  if (url.toString().indexOf("https") === 0) {
    client = https;
  }
  client.get(url, (_res) => {
    let chunks = [];
    // a chunk of data has been recieved.
    _res.on("data", (chunk) => {
      chunks.push(chunk);
    });
    // the whole response has been received.
    _res.on("end", () => {
      const buf = Buffer.concat(chunks);
      const content = buf.toString("utf-8");
      res.json({ content: content });
    });
  }).on("error", (err) => {
    res.json({ error: err });
  });
});

// start listening
app.listen(PORT, () => {
  console.log(`Server is running localhost on port: ${PORT}`)
});
