/**
 * @license Ticket Tagger automatically predicts and labels issue types.
 * Copyright (C) 2018-2021  Rafael Kallis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * @file app.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const { promisify } = require("util");
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const { Classifier } = require("./classifier");
const { GitHubAppClient } = require("./github");
const { WebApp } = require("./WebApp");
const { WebhookApp } = require("./WebhookApp");

function App({ config }) {
  const classifier = Classifier.createFromRemote({
    config,
    modelUri: config.FASTTEXT_MODEL_URI,
  });
  const appClient = new GitHubAppClient({ config });
  const webApp = new WebApp({ config, appClient });
  const webhookApp = new WebhookApp({ config, classifier, appClient });

  const app = express();

  app.enable("trust proxy");

  app.get("/status", (req, res) =>
    res.status(200).send({ message: "ticket-tagger lives!" })
  );

  app.use(webhookApp.middleware);

  app.use(webApp);

  const server = http.createServer(app);

  const connections = new Set();
  server.on("connection", (conn) => {
    connections.add(conn);
    conn.on("close", () => {
      connections.delete(conn);
    });
  });

  return { start, stop, server };

  async function start() {
    await mongoose.connect(config.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      useCreateIndex: true,
      useFindAndModify: true,
    });

    await classifier.initialize();

    await webhookApp.start();

    await promisify((cb) => server.listen(config.PORT, "0.0.0.0", cb))();

    console.info(`ticket-tagger listening on port ${config.PORT}`);
  }

  async function stop() {
    if (server.listening) {
      await promisify((cb) => server.close(cb))();
      await promisify(setImmediate)();
      console.info("server stopped listening");
    }

    connections.forEach((connection) => connection.end());
    await promisify(setImmediate)();
    connections.forEach((connection) => connection.destroy());
    await promisify(setImmediate)();
    connections.clear();
    console.info("connections closed");

    await webhookApp.stop();

    await mongoose.disconnect();
  }
}

module.exports = { App };
