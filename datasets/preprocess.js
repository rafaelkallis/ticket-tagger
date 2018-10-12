/**
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

const natural = require('natural');
const parse = require('csv-parse/lib/sync');
const stringify = require('csv-stringify/lib/sync');
const fs = require('fs');

const inRows = parse(fs.readFileSync('./github_issues.csv').toString());
const outRows = [['label', 'stem']];
for (const [label, title, body] of inRows.slice(1)) {
  const stem = natural.PorterStemmer.tokenizeAndStem(title + " " + body);
  outRows.push([label, stem.join(" ")]);
}

fs.writeFileSync('./processed_github_issues.csv', stringify(outRows));
