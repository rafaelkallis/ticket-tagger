/**
 * @file ticket classifier
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

const path = require('path');
const {Classifier} = require('fasttext');
const Reader = require('./dataset-reader');
const fs = require('fs');
const {magenta, bgMagenta} = require('chalk');
const Liner = require('n-readlines');
const hash = require('object-hash');
const Table = require('cli-table');
const ConfusionMatrix = require('ml-confusion-matrix');
const franc = require('franc');

const datasetPath = path.resolve(__dirname, '../github_dataset.txt');
const testPath = path.resolve(__dirname, '../test.txt');
const trainPath = path.resolve(__dirname, '../train.txt');

const classifier = new Classifier(path.resolve(__dirname, '../model.bin'));
 
async function predict(text) {
  // return [['bug','enhancement','question'][(Math.random() * 2.9999999999999999)|0],0];
  const [prediction] = await classifier.predict(text);
  if (!prediction) { return [null, 0]; }
  const {label, value} = prediction;
  return [label.substring(9), value];
}
exports.predict = predict;

/**
 * Trains the model with all available data
 */
async function train() {
  await classifier.train('supervised', {
    input: datasetPath,
    output: path.resolve(__dirname, '../model'),
    minCount: 14,
  });
}
exports.train = train;

async function benchmark(folds = 10) {
  console.log(magenta(`starting ${folds} fold validation...`));
  const measures = [];
  let liner, line;
  for (let i = 0; i < folds; i++) {
    fs.writeFileSync(testPath, '',);
    fs.writeFileSync(trainPath, '',);
    liner = new Liner(datasetPath);
    while (line = liner.next()) {
      line = line.toString();
      const bucket = parseInt(hash(line).substring(0, 11), 16) % folds;
      fs.appendFileSync(bucket === i ? testPath : trainPath, line + '\n');
    }

    await classifier.train('supervised', {
      input: trainPath,
      output: path.resolve(__dirname, '../model'),
      minCount: 14,
    });

    liner = new Liner(testPath);
    const actualLabels = [];
    const predictedLabels = [];
    while (line = liner.next()) {
      line = line.toString();
      let [actual] = line.match(/^__label__[a-z]+/);
      actual = actual.substring(9);
      const text = line.substring(actual.length + 10);

      const [prediction, similarity] = await predict(text);

      actualLabels.push(actual);
      predictedLabels.push(prediction);
    }
    const cm = ConfusionMatrix.fromLabels(actualLabels, predictedLabels);
    measures.push(['bug','enhancement', 'question'].reduce((o, label) => ({...o, [label]: {
      precision: parseFloat(cm.getPositivePredictiveValue(label).toFixed(3)),
      recall: parseFloat(cm.getTruePositiveRate(label).toFixed(3)),
      f1: parseFloat(cm.getF1Score(label).toFixed(3)),
    }}), {
      accuracy: parseFloat(cm.getAccuracy().toFixed(3)),
    }));
    console.log(magenta(`run ${i+1}/${folds} finished`));
  }
  console.log(bgMagenta('  stats  '));
  console.log(magenta('accuracy: '), mean(measures.map(m => m.accuracy)).toFixed(3));

  for (const label of ['bug','enhancement','question']) {
    console.log(bgMagenta(`   ${label}   `));
    console.log(magenta('precision: '), mean(measures.map(m => m[label].precision)).toFixed(3));
    console.log(magenta('recall: '), mean(measures.map(m => m[label].recall)).toFixed(3));
    console.log(magenta('f1 score: '), mean(measures.map(m => m[label].f1)).toFixed(3));
  }
}
exports.benchmark = benchmark;

const mean = arr => arr.reduce((a, b) => a + b) / arr.length;
