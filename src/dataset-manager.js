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
 * @file dataset-manager.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const path = require("path");
const fs = require("fs");
const { promisify } = require("util");
const pipeline = promisify(require("stream").pipeline);
const fetch = require("node-fetch");
const config = require("./config");
const readline = require("readline");
const crypto = require("crypto");

exports.DatasetManager = class DatasetManager {
  /**
   * Fetch a dataset.
   * @param {string} datasetUri URI of the dataset.
   * @param {boolean} force
   */
  async fetch(datasetUri, force = false) {
    const datasetId = await this.fetchId(datasetUri);
    const datasetPath = path.join(config.DATASET_DIR, `${datasetId}.txt`);
    if (force || !fs.existsSync(datasetPath)) {
      const response = await fetch(datasetUri);
      await pipeline(response.body, fs.createWriteStream(datasetPath));
    }
    return { id: datasetId, path: datasetPath, uri: datasetUri };
  }

  /**
   * Fetches the Id of the dataset. Id is based on ETag of the dataset.
   * @param {string} datasetUri URI of the datasaet.
   */
  async fetchId(datasetUri) {
    const response = await fetch(datasetUri, { method: "HEAD" });
    const datasetId = response.headers.get("ETag");
    if (!datasetId) {
      throw new Error('no "ETag" header found');
    }
    return encodeURIComponent(datasetId);
  }

  /**
   *
   * @param {object} opts
   * @param {string} opts.datasetUri
   * @param {number} opts.folds
   * @param {number} opts.run
   * @param {boolean} opts.force
   */
  async fetchFold({ datasetUri, folds, run, force = false }) {
    if (run >= folds) {
      throw new Error("'run' must be less than 'folds'");
    }
    const { id: datasetId, path: datasetPath } = await this.fetch(
      datasetUri,
      force
    );
    const id = `${datasetId}_${folds}_${run}`;
    const trainPath = path.join(config.DATASET_DIR, `${id}_train.txt`);
    const testPath = path.join(config.DATASET_DIR, `${id}_test.txt`);
    if (force || !fs.existsSync(trainPath) || !fs.existsSync(testPath)) {
      fs.writeFileSync(testPath, "");
      fs.writeFileSync(trainPath, "");
      const datasetLines = readline.createInterface({
        input: fs.createReadStream(datasetPath),
      });
      for await (const line of datasetLines) {
        const bucket = hash(line) % folds;
        fs.appendFileSync(bucket === run ? testPath : trainPath, line + "\n");
      }
    }
    return { id, trainPath, testPath };
    function hash(text) {
      const digest = crypto
        .createHash("md5")
        .update(text, "utf8")
        .digest("hex");
      return parseInt(digest.substring(0, 11), 16);
    }
  }
};
