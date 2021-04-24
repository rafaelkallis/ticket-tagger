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
const { Netmask } = require("netmask");
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

  const middleware = express.Router();

  let hookIps = [];

  /* github ip whitelist */
  middleware.use(function githubIpWhitelist(req, res, next) {
    const match = hookIps.some((hookIp) => hookIp.contains(req.ip));
    return match ? next() : res.sendStatus(403);
  });

  middleware.use(createNodeMiddleware(webhooks, { path: "/" }));

  async function start() {
    /* add github hook ips to whitelist*/
    const meta = await appClient.getMeta();
    hookIps = meta.hooks.map((hook) => new Netmask(hook));

    /* add localhost to whitelist during development */
    if (!config.isProduction) {
      hookIps.push(new Netmask("127.0.0.1"));
    }
  }

  async function stop() {
    hookIps = [];
  }

  return { start, stop, middleware };
}

module.exports = { WebhookApp };
