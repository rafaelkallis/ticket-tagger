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
 * @file webhook app
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const express = require("express");
const { Webhooks, createNodeMiddleware } = require("@octokit/webhooks");
const telemetry = require("./telemetry");
const { repositoryConfigDefaults } = require("./github");

function WebhookApp({ config, classifier, appClient }) {
  const webhooks = new Webhooks({ secret: config.GITHUB_SECRET });

  webhooks.on("issues.opened", handleIssueOpened);
  async function handleIssueOpened({ payload }) {
    const { installation, repository, issue } = payload;

    const installationClient = await appClient.createInstallationClient({
      installation,
    });

    /* abort if no issues write permission */
    if (!installationClient.canWrite("issues")) return;

    const repositoryClient = installationClient.createRepositoryClient({
      repository,
    });

    const repositoryConfig = installationClient.canRead("single_file")
      ? await repositoryClient.getConfig().then(({ json }) => json)
      : repositoryConfigDefaults;

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

    await installationClient.revokeAccessToken();
  }

  webhooks.on("installation.created", async () => {
    telemetry.event("Installed");
  });

  return express().use(createNodeMiddleware(webhooks, { path: "/webhook" }));
}

module.exports = { WebhookApp };
