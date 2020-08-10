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
 * @file benchmark.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const path = require("path");
const fs = require("fs");

const { Classifier } = require("fasttext");
const { magenta, bgMagenta } = require("chalk");
const readline = require("readline");
const hash = require("object-hash");
const ConfusionMatrix = require("ml-confusion-matrix");

const datasetPath = path.resolve(__dirname, "../dataset.txt");
const testPath = path.resolve(__dirname, "../test.txt");
const trainPath = path.resolve(__dirname, "../train.txt");
const modelPath = path.resolve(__dirname, "../model");
const labels = ["__label__bug", "__label__enhancement", "__label__question"];
const folds = 10;

const config = {
  // wordNgrams: 1,
  // minCount: 3
};

benchmark();

/**
 * Perform a benchmark on the model.
 *
 * @param {number} folds - The number of folds to perform
 * @returns {void}
 */
async function benchmark() {
  const classifier = new Classifier();
  console.log(magenta(`starting ${folds} fold validation...`));
  const measures = [];
  for (let i = 0; i < folds; i++) {
    fs.writeFileSync(testPath, "");
    fs.writeFileSync(trainPath, "");
    const datasetLines = readline.createInterface({ input: fs.createReadStream(datasetPath) });
    for await (const line of datasetLines) {
      const bucket = parseInt(hash(line).substring(0, 11), 16) % folds;
      fs.appendFileSync(bucket === i ? testPath : trainPath, line + "\n");
    }

    await classifier.train("supervised", {
      input: trainPath,
      output: modelPath,
      ...config,
    });

    await classifier.loadModel(modelPath);

    const testLines = readline.createInterface({ input: fs.createReadStream(testPath) })
    const actualLabels = [];
    const predictedLabels = [];
    for await (const line of testLines) {
      const [actual] = line.match(/__label__[a-z]+/);
      const text = line.substring(actual.length);
      const [prediction = { label: null }] = await classifier.predict(text);
      actualLabels.push(actual);
      predictedLabels.push(prediction.label);
    }
    const cm = ConfusionMatrix.fromLabels(actualLabels, predictedLabels);
    measures.push(
      labels.reduce(
        (o, label) => ({
          ...o,
          [label]: {
            precision: parseFloat(
              cm.getPositivePredictiveValue(label).toFixed(3)
            ),
            recall: parseFloat(cm.getTruePositiveRate(label).toFixed(3)),
            f1: parseFloat(cm.getF1Score(label).toFixed(3))
          }
        }),
        {
          accuracy: parseFloat(cm.getAccuracy().toFixed(3))
        }
      )
    );
    console.log(magenta(`run ${i + 1}/${folds} finished`));
  }
  console.log(bgMagenta("  stats  "));
  console.log(
    magenta("accuracy: "),
    mean(measures.map(m => m.accuracy)).toFixed(3)
  );

  for (const label of labels) {
    console.log(bgMagenta(`   ${label.substring(9)}   `));
    console.log(
      magenta("precision: "),
      mean(measures.map(m => m[label].precision)).toFixed(3)
    );
    console.log(
      magenta("recall: "),
      mean(measures.map(m => m[label].recall)).toFixed(3)
    );
    console.log(
      magenta("f1 score: "),
      mean(measures.map(m => m[label].f1)).toFixed(3)
    );
  }
}

/**
 * Computes the arithemtic mean.
 *
 * @param {array<number>} arr - The vector of values to compute the mean of.
 * @returns {number} The arithmetic mean.
 */
function mean(arr) { return arr.reduce((a, b) => a + b) / arr.length; }

function computeBucket(text, folds) {
  const bucket = parseInt(hash(text).substring(0, 11), 16) % folds;
  return bucket;
}