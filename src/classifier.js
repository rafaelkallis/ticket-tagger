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
 * @file ticket classifier
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const path = require("path");
const { promisify } = require("util");
const fs = require("fs");
const pipeline = promisify(require("stream").pipeline);
const fasttext = require("fasttext");
const fetch = require("node-fetch");

class Classifier {
  constructor(modelFilepath) {
    this.fasttextClassifier = new fasttext.Classifier(modelFilepath);
  }

  /**
   * Predicts a label given an issue body.
   *
   * @param {string} text - The issue body.
   * @returns {[string, number]} A tuple containing the predicted label and a similarity score.
   */
  async predict(text) {
    // return [['bug','enhancement','question'][(Math.random() * 2.9999999999999999)|0],0];
    const [prediction] = await this.fasttextClassifier.predict(text);
    if (!prediction) {
      return [null, 0];
    }
    const { label, value } = prediction;
    return [label.substring(9), value];
  }
}

class ClassifierFactory {
  constructor({ config }) {
    this.config = config;
  }

  async createClassifierFromRemote({ modelUri }) {
    console.info("checking latest model");
    const latestModelVersion = await this._fetchLatestVersion({
      uri: modelUri,
    });
    console.info(`latest model version: ${latestModelVersion}`);
    const modelPath = path.join(
      this.config.MODEL_DIR,
      `${latestModelVersion}.bin`
    );
    if (await this._existsLocally({ path: modelPath })) {
      console.info("latest model found locally");
    } else {
      console.info("latest model not found locally");
      await this._fetchLatestModel({ modelUri, modelPath });
    }
    return this.createClassifierFromLocal({ modelPath });
  }

  async createClassifierFromLocal({ modelPath }) {
    if (!(await this._existsLocally({ path: modelPath }))) {
      throw new Error(`File ${modelPath} does not exist.`);
    }
    return new Classifier(modelPath);
  }

  async _existsLocally({ path }) {
    return fs.promises
      .access(path, fs.constants.R_OK | fs.constants.W_OK)
      .then(() => true)
      .catch(() => false);
  }

  async _fetchLatestVersion({ uri }) {
    const response = await fetch(uri, { method: "HEAD" });
    const modelId = response.headers.get("ETag");
    if (!modelId) {
      throw new Error('no "ETag" header found');
    }
    return modelId;
  }

  async _fetchLatestModel({ modelUri, modelPath }) {
    console.info("fetching latest model");
    const response = await fetch(modelUri);
    await pipeline(response.body, fs.createWriteStream(modelPath));
  }
}

module.exports = { Classifier, ClassifierFactory };
