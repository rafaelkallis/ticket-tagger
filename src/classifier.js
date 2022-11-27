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
 * @file ticket classifier
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const path = require("path");
const { promisify } = require("util");
const fs = require("fs");
const pipeline = promisify(require("stream").pipeline);
const { FastText } = require("@rafaelkallis/fasttext");
const fetch = require("node-fetch");

class Classifier {
  constructor({ modelPath }) {
    this._modelPath = modelPath;
    this._initialized = false;
    this._fasttext = null;
  }

  static createFromRemote({ config, modelUri }) {
    return new RemoteModelClassifier({ config, modelUri });
  }

  static createFromLocal({ modelPath }) {
    return new Classifier({ modelPath });
  }

  /**
   * Predicts a label given an issue body.
   *
   * @param {string} text - The issue body.
   * @returns {[string, number]} A tuple containing the predicted label and a similarity score.
   */
  async predict(text) {
    if (!this._initialized) throw new Error("not initialized");
    // return [['bug','enhancement','question'][(Math.random() * 2.9999999999999999)|0],0];
    const [prediction] = await this._fasttext.predict(text);
    if (!prediction) {
      return [null, 0];
    }
    return prediction;
  }

  async initialize() {
    if (this._initialized) throw new Error("already initialized");
    this._fasttext = await FastText.from(this._modelPath);
    this._initialized = true;
    return this;
  }
}

class RemoteModelClassifier extends Classifier {
  constructor({ config, modelUri }) {
    super({ modelPath: null });
    this._config = config;
    this._modelUri = modelUri;
  }

  async initialize() {
    if (this._initialized) throw new Error("already initialized");
    console.info("checking latest model");
    const latestModelVersion = await this._fetchRemoteModelVersion();
    console.info(`latest model version: ${latestModelVersion}`);
    this._modelPath = path.join(
      this._config.MODEL_DIR,
      `${latestModelVersion}.bin`
    );
    if (await this._existsLocally({ path: this._modelPath })) {
      console.info("latest model found locally");
    } else {
      console.info("latest model not found locally");
      await this._fetchRemoteModel({ modelPath: this._modelPath });
    }
    return super.initialize();
  }

  async _existsLocally() {
    return fs.promises
      .access(this._modelPath, fs.constants.R_OK | fs.constants.W_OK)
      .then(() => true)
      .catch(() => false);
  }

  async _fetchRemoteModelVersion() {
    const response = await fetch(this._modelUri, { method: "HEAD" });
    const modelId = response.headers.get("ETag");
    if (!modelId) {
      throw new Error('no "ETag" header found');
    }
    return modelId;
  }

  async _fetchRemoteModel() {
    console.info("fetching latest model");
    const response = await fetch(this._modelUri);
    await pipeline(response.body, fs.createWriteStream(this._modelPath));
  }
}

module.exports = { Classifier };
