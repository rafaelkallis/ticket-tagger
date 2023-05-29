/**
 * @license AGPL-3.0
 * Ticket Tagger automatically predicts and labels issue types.
 * Copyright (C) 2018-2023  Rafael Kallis
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

import express from "express";
import { Webhooks, createNodeMiddleware } from "@octokit/webhooks";
import ipaddr from "ipaddr.js";
import { Config } from "./Config";
import { Classifier } from "./Classifier";
import { GitHubAppClient, repositoryConfigDefaults } from "./Github";
import telemetry from "./telemetry";

interface WebhookAppOptions {
  config: Config;
  classifier: Classifier;
  appClient: GitHubAppClient;
}

export function WebhookApp({ config, classifier, appClient }: WebhookAppOptions) {
  const webhooks = new Webhooks({ secret: config.GITHUB_SECRET });

  webhooks.on("issues.opened", async function handleIssueOpened({ payload }) {
    const { installation, repository, issue } = payload;
    if (!installation) throw new Error("installation not found");

    const installationClient = await appClient.createInstallationClient({
      installation,
    });

    /* abort if no issues write permission */
    if (!installationClient.canWrite("issues")) return;

    const repositoryClient = installationClient.createRepositoryClient({
      repository,
    });

    // TODO remove any
    const repositoryConfig: any = installationClient.canRead("single_file")
      ? await repositoryClient.getConfig().then(({ json }) => json)
      : repositoryConfigDefaults;

    /* predict label */
    const [predictedLabelKey, similarity] = await classifier.predict(
      `${issue.title} ${issue.body}`
    );


    if (predictedLabelKey && similarity > 0) {
      const label = repositoryConfig.labels[predictedLabelKey];
      if (label.enabled) {
        /* update label */
        await repositoryClient.setIssueLabels({
          issue: issue.number,
          labels: [...(issue.labels || []), label.text],
        });
      }

      telemetry.event("Classified");
    }

    await installationClient.revokeAccessToken();
  });

  webhooks.on("installation.created", async () => {
    telemetry.event("Installed");
  });

  const middleware = express.Router();

  const ipWhitelist = new IpWhitelist();

  /* github ip whitelist */
  middleware.use(function githubIpWhitelist(req, res, next) {
    const match = ipWhitelist.contains(req.ip);
    return match ? next() : res.sendStatus(403);
  });

  middleware.use(createNodeMiddleware(webhooks, { path: "/" }));

  async function start() {
    /* add github hook ips to whitelist */
    /* https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses */
    const meta = await appClient.getMeta();
    ipWhitelist.addRanges(meta.hooks);

    /* add localhost to whitelist during development */
    if (config.NODE_ENV !== "production") {
      ipWhitelist.addRange("127.0.0.0/8");
    }
  }

  async function stop() {
    ipWhitelist.clear();
  }

  return { start, stop, middleware, webhooks };
}

class IpWhitelist {
  private readonly _ipRanges: [ipaddr.IPv4 | ipaddr.IPv6, number][];
  constructor() {
    this._ipRanges = [];
  }

  addRange(cidr: string) {
    this._ipRanges.push(ipaddr.parseCIDR(cidr));
  }

  addRanges(cidrs: string[]) {
    cidrs.forEach((cidr) => this.addRange(cidr));
  }

  clear() {
    this._ipRanges.length = 0;
  }

  contains(ip: string) {
    const addr = ipaddr.parse(ip);
    return this._ipRanges.some(
      (ipRange) => addr.kind === ipRange[0].kind && addr.match(ipRange)
    );
  }
}
