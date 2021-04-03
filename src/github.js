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
const config = require("./config");
const { repositoryConfigSchema } = require("./schemata");

const baseUrl = "https://api.github.com";

class GitHubAppClient {
  constructor({ config }) {
    this.config = config;
  }

  async createRepositoryClient({ installation, repository }) {
    const installationAccessToken = await this.createRepositoryAccessToken({
      installation,
      repository,
    });
    return new GitHubRepositoryClient({
      config: this.config,
      repository,
      installationAccessToken,
    });
  }

  /**
   * Get permissions of installation for the authenticated app.
   * @see https://docs.github.com/en/rest/reference/apps#get-an-installation-for-the-authenticated-app
   */
  async getInstallationPermissions({ installation }) {
    const url = `${baseUrl}/app/installations/${installation.id}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.createAppAccessToken()}`,
        "User-Agent": "Ticket-Tagger",
        Accept: "application/vnd.github.v3+json",
      },
    });
    const { permissions } = await response.json();
    return {
      raw: permissions,
      canRead(permission) {
        return ["read", "write"].includes(permissions[permission]);
      },
      canWrite(permission) {
        return ["write"].includes(permissions[permission]);
      },
    };
  }

  /**
   * Create an installation access token for a repository.
   * @see https://docs.github.com/en/rest/reference/apps#create-an-installation-access-token-for-an-app
   */
  async createRepositoryAccessToken({ installation, repository }) {
    const url = `${baseUrl}/app/installations/${installation.id}/access_tokens`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.createAppAccessToken()}`,
        "User-Agent": "Ticket-Tagger",
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({ repository_ids: [repository.id] }),
    });
    const body = await response.json();
    return body.token;
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

class GitHubRepositoryClient {
  constructor({ config, repository, installationAccessToken }) {
    this.config = config;
    this.repository = repository;
    this.installationAccessToken = installationAccessToken;
  }

  /**
   * Set the issue's labels.
   * @see https://docs.github.com/en/rest/reference/issues#update-an-issue
   */
  async setIssueLabels({ issue, labels }) {
    const url = `${this.repository.url}/issues/${issue}/labels`;
    return await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `token ${this.installationAccessToken}`,
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
  async getRepositoryConfig() {
    const url = `${this.repository.url}/contents/${this.config.CONFIG_FILE_PATH}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `token ${this.installationAccessToken}`,
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
    let repositoryConfig = {};
    try {
      repositoryConfig = yaml.parse(repositoryConfigYaml);
    } catch (err) {
      repositoryConfig = {};
    }
    if (repositoryConfigSchema.validate(repositoryConfig).error) {
      repositoryConfig = {};
    }
    return repositoryConfig;
  }

  async revokeAccessToken() {
    const url = `${baseUrl}/app/installation/token`;
    await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `token ${this.installationAccessToken}`,
        "User-Agent": "Ticket-Tagger",
        Accept: "application/vnd.github.v3+json",
      },
    });
  }
}

module.exports = new GitHubAppClient({ config });
