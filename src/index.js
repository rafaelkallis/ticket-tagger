/**
 * @file index.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

const Koa = require('koa');
const body = require('koa-bodyparser');
const {post} = require('koa-route');
const classifier = require('./fasttext');
const github = require('./github-utils');
const config = require('./config');

const app = new Koa();
app.use(body());

/* POST /webhook endpoint */
app.use(post('/webhook', async ctx => {

  /* payload integrity check */
  ctx.assert(
    github.verifySignature({
      payload: JSON.stringify(ctx.request.body),
      secret: config.githubSecret,
      signature: ctx.headers['x-hub-signature'],
    }), 
    401, 
    'invalid signature',
  );

  /* issue opened handler */
  if (ctx.request.body.action === 'opened') {

    /* extract relevant issue metadata */
    const { title, labels, body, url } = ctx.request.body.issue;

    /* predict label */
    const [prediction, similarity] = await classifier.predict(`${title} ${body}`);

    /* extract installation id */
    const installationId = ctx.request.body.installation.id;

    /* get access token for repository */
    const accessToken = await github.getAccessToken({installationId});

    /* update label */
    await github.setLabels({
      labels: [...labels, prediction], 
      issue: url, 
      accessToken,
    });
  }

  ctx.status = 200;
}));

app.listen(config.port, async () => { 
  console.info(`ticket-tagger listening on port ${config.port}`);
});
