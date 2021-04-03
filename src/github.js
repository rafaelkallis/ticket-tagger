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
 * @file github.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const jwt = require("jsonwebtoken");
const fetch = require("node-fetch");
const yaml = require("yaml");
const Joi = require("joi");
const config = require("./config");

const repositoryConfigSchema = Joi.object({
  version: Joi.number().allow(3),
  labels: Joi.object().pattern(
    Joi.string().valid("bug", "enhancement", "question"),
    {
      text: Joi.string().length(50),
    }
  ),
});

class GitHubClient {
  constructor({ config }) {
    this.config = config;
  }

  /**
   * Set the issue's labels.
   * @see https://docs.github.com/en/rest/reference/issues#update-an-issue
   */
  async setLabels({ repository, issue, labels, installationAccessToken }) {
    return await fetch(`${repository}/issues/${issue}/labels`, {
      method: "PUT",
      headers: {
        Authorization: `token ${installationAccessToken}`,
        "User-Agent": "Ticket-Tagger",
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({ labels }),
    });
  }

  /**
   * Get the repository's tickettager config.
   * @see https://docs.github.com/en/rest/reference/repos#get-repository-content
   */
  async getRepositoryConfig({ repository, installationAccessToken }) {
    const url = `${repository}/contents/${this.config.CONFIG_FILE_PATH}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `token ${installationAccessToken}`,
        "User-Agent": "Ticket-Tagger",
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (!response.ok) {
      return {};
    }
    const body = await response.json();
    const repositoryConfigYaml = Buffer.from(body.content, "base64").toString(
      "utf8"
    );
    let repositoryConfig;
    try {
      repositoryConfig = yaml.parse(repositoryConfigYaml);
    } catch (err) {
      return {};
    }
    if (repositoryConfigSchema.validate(repositoryConfig).error) {
      return {};
    }
    return repositoryConfig;
  }

  /**
   * Create an installation access token.
   * @see https://docs.github.com/en/rest/reference/apps#create-an-installation-access-token-for-an-app
   */
  async createInstallationAccessToken({ installationId }) {
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.createAppAccessToken()}`,
          "User-Agent": "Ticket-Tagger",
          "Content-Type": "application/json",
          Accept: "application/vnd.github.v3+json",
        },
      }
    );
    const { token } = await response.json();
    return token;
  }

  /**
   * Creates a new JWT for authorizing ticket-tagger.
   * Used for requesting installation specific access tokens.
   * @see https://docs.github.com/en/developers/apps/authenticating-with-github-apps#authenticating-as-a-github-app
   *
   * @returns {String} A ticket-tagger JWT
   */
  createAppAccessToken() {
    const iat = (Date.now() / 1000) | 0;
    const exp = iat + 30;
    const iss = this.config.GITHUB_APP_ID;
    return jwt.sign({ iat, exp, iss }, this.config.GITHUB_CERT, {
      algorithm: "RS256",
    });
  }
}

module.exports = new GitHubClient({ config });
