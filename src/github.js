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
 * @file github.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const fetch = require("node-fetch");
const yaml = require("yaml");
const { repositoryConfigSchema } = require("./schemata");
const { CacheRecord } = require("./entities/CacheRecord");

class GitHubClient {
  constructor({ config }) {
    this.config = config;
    this.baseUrl = "https://api.github.com";
  }

  _url(path) {
    return this.baseUrl + path;
  }

  _headers(headers = {}) {
    return {
      "User-Agent": "Ticket-Tagger",
      Accept: "application/vnd.github.v3+json",
      ...headers,
    };
  }

  /**
   * Uses conditional requests for improved rate limits.
   * @see https://docs.github.com/en/rest/guides/getting-started-with-the-rest-api#conditional-requests
   */
  async _fetchJsonConditional(url, options) {
    const cacheKey = crypto
      .createHash("md5")
      .update("github")
      .update(url)
      .update(options.headers.Authorization || "public")
      .digest("hex");
    let cacheRecord = await CacheRecord.findOne({ key: cacheKey });
    if (cacheRecord) {
      options.headers["If-None-Match"] = cacheRecord.etag;
    }
    const response = await fetch(url, options);
    if (response.status === 304) {
      return cacheRecord.payload;
    }
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const etag = response.headers.get("ETag");
    const payload = await response.json();
    if (!cacheRecord) {
      cacheRecord = new CacheRecord({ key: cacheKey });
    }
    cacheRecord.etag = etag;
    cacheRecord.payload = payload;
    await cacheRecord.save();
    return payload;
  }
}

class GitHubOAuthClient extends GitHubClient {
  constructor({ config, accessToken }) {
    super({ config });
    this.accessToken = accessToken;
  }

  /**
   * @see https://docs.github.com/en/rest/reference/apps#check-a-token
   */
  async checkToken() {
    const url = this._url(
      `/applications/${this.config.GITHUB_CLIENT_ID}/token`
    );
    const response = await fetch(url, {
      method: "POST",
      headers: this._headersWithClientSecretBasicAuth({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ access_token: this.accessToken }),
    });
    if (!response.ok) {
      return false;
    }
    const { user } = await response.json();
    return user;
  }

  /**
   * @see https://docs.github.com/en/rest/reference/users#get-the-authenticated-user
   */
  async getUser() {
    const url = this._url("/user");
    return await this._fetchJsonConditional(url, { headers: this._headers() });
  }

  /**
   * @see https://docs.github.com/en/rest/reference/repos#get-a-repository
   */
  async getRepository({ owner, repo }) {
    const url = this._url(`/repos/${owner}/${repo}`);
    return await this._fetchJsonConditional(url, { headers: this._headers() });
  }

  /**
   * @see https://docs.github.com/en/rest/reference/apps#list-app-installations-accessible-to-the-user-access-token
   */
  async listInstallations() {
    const url = this._url("/user/installations");
    const { installations } = await this._fetchJsonConditional(url, {
      headers: this._headers(),
    });
    return installations;
  }

  /**
   * @see https://docs.github.com/en/rest/reference/apps#list-repositories-accessible-to-the-user-access-token
   */
  async listRepositoriesByInstallationId({ installationId }) {
    const url = this._url(`/user/installations/${installationId}/repositories`);
    const { repositories } = await this._fetchJsonConditional(url, {
      headers: this._headers(),
    });
    return repositories;
  }

  _headers(headers = {}) {
    return super._headers({
      Authorization: `token ${this.accessToken}`,
      ...headers,
    });
  }

  _headersWithClientSecretBasicAuth(headers = {}) {
    const basicAuthToken = Buffer.from(
      `${this.config.GITHUB_CLIENT_ID}:${this.config.GITHUB_CLIENT_SECRET}`
    ).toString("base64");
    return this._headers({
      Authorization: `Basic ${basicAuthToken}`,
      ...headers,
    });
  }
}

class GitHubAppClient extends GitHubClient {
  async createRepositoryClient({ installation, repository }) {
    const accessToken = await this._createInstallationAccessTokenForRepository({
      installation,
      repository,
    });
    return new GitHubRepositoryClient({
      config: this.config,
      repository,
      accessToken,
    });
  }

  /**
   * Get permissions of installation for the authenticated app.
   * @see https://docs.github.com/en/rest/reference/apps#get-an-installation-for-the-authenticated-app
   */
  async getInstallationPermissions({ installation }) {
    const url = this._url(`/app/installations/${installation.id}`);
    const response = await fetch(url, { headers: this._headers() });
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
  async _createInstallationAccessTokenForRepository({
    installation,
    repository,
  }) {
    const url = this._url(
      `/app/installations/${installation.id}/access_tokens`
    );
    const response = await fetch(url, {
      method: "POST",
      headers: this._headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ repository_ids: [repository.id] }),
    });
    const body = await response.json();
    return body.token;
  }

  _headers(headers = {}) {
    return super._headers({
      Authorization: `Bearer ${this._createAppAccessToken()}`,
      ...headers,
    });
  }

  /**
   * Creates a new JWT for authorizing ticket-tagger.
   * Used for requesting installation specific access tokens.
   * @see https://docs.github.com/en/developers/apps/authenticating-with-github-apps#authenticating-as-a-github-app
   *
   * @returns {String} A ticket-tagger JWT
   */
  _createAppAccessToken() {
    const iat = (Date.now() / 1000) | 0;
    const exp = iat + 30;
    const iss = this.config.GITHUB_APP_ID;
    return jwt.sign({ iat, exp, iss }, this.config.GITHUB_CERT, {
      algorithm: "RS256",
    });
  }
}

class GitHubInstallationClient extends GitHubClient {
  constructor({ config, installation, accessToken }) {
    super({ config });
    this.installation = installation;
    this.accessToken = accessToken;
  }

  async revokeAccessToken() {
    const url = this._url("/app/installation/token");
    await fetch(url, { method: "DELETE", headers: this._headers() });
  }

  async _headers(headers = {}) {
    return super._headers({
      ...headers,
      Authorization: `token ${this.accessToken}`,
    });
  }
}

class GitHubRepositoryClient extends GitHubInstallationClient {
  constructor({ config, installation, repository, accessToken }) {
    super({ config, installation, accessToken });
    this.repository = repository;
  }

  async _url(url) {
    return this.repository.url + url;
  }

  /**
   * Set the issue's labels.
   * @see https://docs.github.com/en/rest/reference/issues#update-an-issue
   */
  async setIssueLabels({ issue, labels }) {
    const url = this._url(`/issues/${issue}/labels`);
    return await fetch(url, {
      method: "PUT",
      headers: this._headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ labels }),
    });
  }

  /**
   * Get the repository's tickettager config.
   * @see https://docs.github.com/en/rest/reference/repos#get-repository-content
   */
  async getRepositoryConfig() {
    const url = this._url(`/contents/${this.config.CONFIG_FILE_PATH}`);
    const response = await fetch(url, { headers: this._headers() });
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
}

module.exports = { GitHubOAuthClient, GitHubAppClient };
