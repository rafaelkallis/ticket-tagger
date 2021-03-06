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

const express = require("express");
const { Webhooks, createNodeMiddleware } = require("@octokit/webhooks");
const { defaultsDeep } = require("lodash");
const Joi = require("joi");
const { ClassifierFactory } = require("./classifier");
const github = require("./github");
const config = require("./config");
const telemetry = require("./telemetry");
const { repositoryConfigSchema } = require("./schemata");

const repositoryConfigDefaults = {
  version: 3,
  labels: Object.fromEntries(
    ["bug", "enhancement", "question"].map((label) => [
      label,
      {
        enabled: true,
        text: label,
      },
    ])
  ),
};
Joi.assert(repositoryConfigDefaults, repositoryConfigSchema);

module.exports = async function App() {
  const app = express();
  const classifierFactory = new ClassifierFactory({ config });
  const classifier = await classifierFactory.createClassifierFromRemote({
    modelUri: config.FASTTEXT_MODEL_URI,
  });

  app.get("/status", (req, res) =>
    res.status(200).send({ message: "ticket-tagger lives!" })
  );

  const webhooks = new Webhooks({ secret: config.GITHUB_SECRET });

  webhooks.on("issues.opened", handleIssueOpened);
  async function handleIssueOpened({ payload }) {
    const { installation, repository, issue } = payload;

    /* get installation permissions */
    const permissions = await github.getInstallationPermissions({
      installation,
      repository,
    });

    /* abort if no issue issue permission */
    if (!permissions.canWrite("issues")) return;

    const repositoryClient = await github.createRepositoryClient({
      installation,
      repository,
    });

    let repositoryConfig = {};
    if (permissions.canRead("single_file")) {
      repositoryConfig = await repositoryClient.getRepositoryConfig();
    }
    defaultsDeep(repositoryConfig, repositoryConfigDefaults);

    /* predict label */
    const [predictedLabelKey, similarity] = await classifier.predict(
      `${issue.title} ${issue.body}`
    );

    const label = repositoryConfig.labels[predictedLabelKey];

    if (similarity > 0) {
      if (label.enabled) {
        /* update label */
        await repositoryClient.setIssueLabels({
          issue: issue.number,
          labels: [...issue.labels, label.text],
        });
      }

      telemetry.event("Classified");
    }

    await repositoryClient.revokeAccessToken();
  }

  webhooks.on("installation.created", async () => {
    telemetry.event("Installed");
  });
  app.use(createNodeMiddleware(webhooks, { path: "/webhook" }));

  return app;
};
