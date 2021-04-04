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

const os = require("os");
const path = require("path");
const { promisify } = require("util");
const fs = require("fs");
const pipeline = promisify(require("stream").pipeline);
const fasttext = require("fasttext");
const fetch = require("node-fetch");

exports.Classifier = class Classifier {
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

  static async ofRemoteUri(modelUri) {
    console.info("checking latest model");
    const latestModelVersion = await fetchLatestModelVersion();
    console.info(`latest model version: ${latestModelVersion}`);
    const modelFilepath = path.join(os.tmpdir(), `${latestModelVersion}.bin`);
    if (await latestModelExistsLocally()) {
      console.info("latest model found locally");
    } else {
      console.info("latest model not found locally");
      await fetchLatestModel();
    }
    return new Classifier(modelFilepath);

    async function fetchLatestModelVersion() {
      const response = await fetch(modelUri, { method: "HEAD" });
      const modelId = response.headers.get("ETag");
      if (!modelId) {
        throw new Error('no "ETag" header found');
      }
      return modelId;
    }
    async function latestModelExistsLocally() {
      return fs.promises
        .access(modelFilepath)
        .then(() => true)
        .catch(() => false);
    }
    async function fetchLatestModel() {
      console.info("fetching latest model");
      const response = await fetch(modelUri);
      await pipeline(response.body, fs.createWriteStream(modelFilepath));
    }
  }
};
