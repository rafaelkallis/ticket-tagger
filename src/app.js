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
const appInsights = require("applicationinsights");
const { Classifier } = require("./classifier");
const github = require("./github");
const config = require("./config");

module.exports = async function App() {
  const app = express();
  const classifier = await Classifier.ofRemoteUri(config.FASTTEXT_MODEL_URI);

  app.get("/status", (req, res) =>
    res.status(200).send({ message: "ticket-tagger lives!" })
  );

  const webhooks = new Webhooks({
    secret: config.GITHUB_SECRET,
    path: "/webhook"
  });

  webhooks.on("issues.opened", async ({ payload }) => {
    /* extract relevant issue metadata */
    const { title, labels, body, url } = payload.issue;

    /* predict label */
    const [prediction, similarity] = await classifier.predict(
      `${title} ${body}`
    );

    if (similarity > 0) {
      /* extract installation id */
      const installationId = payload.installation.id;

      /* get access token for repository */
      const accessToken = await github.getAccessToken({ installationId });

      /* update label */
      await github.setLabels({
        labels: [...labels, prediction],
        issue: url,
        accessToken
      });
    }
  });

  webhooks.on("installation.created", async () => {
    appInsights.defaultClient.trackEvent({ name: "installation" });
  });
  app.use(webhooks.middleware);

  return app;
};
