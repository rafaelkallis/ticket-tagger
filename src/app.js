/**
 * @license Ticket Tagger automatically predicts and labels issue types.
 * Copyright (C) 2018,2019,2020  Rafael Kallis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * @file app.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const express = require("express");
const { Webhooks } = require("@octokit/webhooks");
const { Classifier } = require("./classifier");
const github = require("./github");
const config = require("./config");
const telemetry = require("./telemetry");

module.exports = async function App() {
  const app = express();
  const classifier = await Classifier.ofRemoteUri(config.FASTTEXT_MODEL_URI);

  app.get("/status", (req, res) =>
    res.status(200).send({ message: "ticket-tagger lives!" })
  );

  const webhooks = new Webhooks({
    secret: config.GITHUB_SECRET,
    path: "/webhook",
  });

  webhooks.on("issues.opened", async ({ payload }) => {
    /* get access token for repository */
    const accessToken = await github.getAccessToken({
      installationId: payload.installation.id,
    });

    const getConfigResponse = await github.getConfigFile({
      repository: payload.repository.url,
      accessToken,
    });

    /* predict label */
    const [prediction, similarity] = await classifier.predict(
      `${payload.issue.title} ${payload.issue.body}`
    );

    if (similarity > 0) {
      /* update label */
      await github.setLabels({
        repository: payload.repository.url,
        issue: payload.issue.number,
        labels: [...payload.issue.labels, prediction],
        accessToken,
      });

      telemetry.event("Classified");
    }
  });

  webhooks.on("installation.created", async () => {
    telemetry.event("Installed");
  });
  app.use(webhooks.middleware);

  return app;
};
