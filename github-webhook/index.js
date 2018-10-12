/**
 * @file index.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

const Koa = require('koa');
const body = require('koa-bodyparser');
const Router = require('koa-router');
const compose = require('koa-compose');
const request = require('superagent');
const crypto = require('crypto');
const natural = require('natural');
const csvParse = require('csv-parse/lib/sync');
const fs = require('fs');

require('dotenv').config();

const { GITHUB_TOKEN, WEBHOOK_SECRET, PORT, DATASET } = process.env;
const app = new Koa();
const r = new Router();

r.post('/webhook', compose([
  body(),
  async ctx => {
    ctx.assert(ctx.request.body, 400, 'no body provided');
    const digest = crypto.createHmac('sha1', WEBHOOK_SECRET)
      .update(JSON.stringify(ctx.request.body))
      .digest('hex');
    ctx.assert(`sha1=${digest}` === ctx.headers['x-hub-signature'], 401, 'invalid signature');

    /* handler */
    if (ctx.request.body.action === 'opened') {
      let { title, labels, body, url } = ctx.request.body.issue;

      console.log(title);
      labels = [...labels, 'new'];

      await request.patch(url)
        .set('Authorization', `token ${GITHUB_TOKEN}`)
        .send({ labels });
    }
    ctx.status = 200;
  },
]));

app
  .use(r.routes())
  .use(r.allowedMethods());

app.listen(PORT, () => { console.log(`wekabot listening on port ${PORT}`); });

const classifier = new natural.BayesClassifier();
const rows = csvParse(fs.readFileSync(DATASET).toString());
const split = rows.length * 1/3;
const trainRows = rows.slice(1, split);
const testRows = rows.slice(split);
for (let row of trainRows) {
  const [label, title, body] = row;
  // natural.LancasterStemmer.attach();
  // const stem = natural.PorterStemmer.tokenizeAndStem();
  classifier.addDocument(`${title} ${body}`, label);
}
console.log('finished parsing');
classifier.train();
console.log('finished training');
let nCorrent = 0;
for (let row of testRows) {
  const [label, title, body] = row;
  // natural.LancasterStemmer.attach();
  // const stem = natural.PorterStemmer.tokenizeAndStem(`${title} ${body}`);
  const guess = classifier.classify(`${title} ${body}`);
  if (guess === label) {
    nCorrent++;
  }
}
console.log(`precision: ${nCorrent/testRows.length}`);
