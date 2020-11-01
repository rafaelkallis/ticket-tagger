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
 * @file benchmark2.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const fs = require("fs");
const path = require("path");
const yargs = require("yargs");
const { hideBin } = require("yargs/helpers");
const { Classifier } = require("fasttext");
const { magenta, bgMagenta } = require("chalk");
const readline = require("readline");
const hash = require("object-hash");
const ConfusionMatrix = require("ml-confusion-matrix");
const config = require("../src/config");
const { DatasetManager } = require("../src/dataset-manager");

const datasetManager = new DatasetManager();
const classifier = new Classifier();
const labels = ["__label__bug", "__label__enhancement", "__label__question"];

yargs(hideBin(process.argv))
  .command({
    command: "trivial",
    description: "Perform a trivial validation",
    builder: yargs => yargs
      .option("train", { type: "string", demandOption: true, coerce: coerceDataset })
      .option("test", { type: "string", demandOption: true, coerce: coerceDataset }),
    handler: trivialHandler,
  })
  .command({
    command: "cross",
    description: "Perform a cross validation",
    builder: yargs => yargs
      .option("data", { type: "string", demandOption: true, coerce: coerceDataset })
      .option("folds", { type: "number", default: 10 }),
    handler: crossHandler,
  })
  .demandCommand()
  .help()
  .argv;

async function trivialHandler({ test, train }) {
  train = await datasetManager.fetch(train);
  test = await datasetManager.fetch(test);
  const modelPath = path.join(config.MODEL_DIR, `${train.id}.bin`);
  await classifier.train("supervised", {
    input: train.path,
    output: modelPath,
    // ...modelConfig
  });
  await classifier.loadModel(modelPath);
  const { actual, predicted } = await evaluate(test.path);
  printStats({ actual, predicted });
}

function crossHandler(argv) {
  throw new Error('not implemented');
}

async function evaluate(datasetPath) {
  const lines = readline.createInterface({ input: fs.createReadStream(datasetPath) })
  const actualList = [];
  const predictedList = [];
  for await (const line of lines) {
    const [actual] = line.match(/__label__[a-z]+/);
    const text = line.substring(actual.length);
    const [prediction = { label: null }] = await classifier.predict(text);
    actualList.push(actual);
    predictedList.push(prediction.label);
  }
  return { actual: actualList, predicted: predictedList };
}

function printStats({ actual, predicted }) {
  const cm = ConfusionMatrix.fromLabels(actual, predicted);
  console.log(bgMagenta("  stats  "));
  console.log(
    magenta("accuracy: "),
    cm.getAccuracy().toFixed(3),
  );

  for (const label of labels) {
    console.log(bgMagenta(`   ${label.substring(9)}   `));
    console.log(
      magenta("precision: "),
      cm.getPositivePredictiveValue(label).toFixed(3),
    );
    console.log(
      magenta("recall: "),
      cm.getTruePositiveRate(label).toFixed(3),
    );
    console.log(
      magenta("f1 score: "),
      cm.getF1Score(label).toFixed(3),
    );
  }
}

function coerceDataset(arg) {
  const datasetTable = {
    balanced: "https://gist.githubusercontent.com/rafaelkallis/6aa281b00d73d77fc843bd34f8184854/raw/8c10ebf2fd6f937f8667c660ea33d122bac739eb/issues.txt",
    unbalanced: "https://tickettagger.blob.core.windows.net/datasets/dataset-labels-top3-30k-real.txt",
  };
  return datasetTable[arg] || arg;
}

/*
const datasetPath = path.resolve(__dirname, "../dataset.txt");
const testPath = path.resolve(__dirname, "../test.txt");
const trainPath = path.resolve(__dirname, "../train.txt");
const modelPath = path.resolve(__dirname, "../model");
const folds = 10;

benchmark();
*/

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