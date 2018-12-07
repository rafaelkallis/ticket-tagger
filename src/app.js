/**
 * @file app.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const Koa = require("koa");
const body = require("koa-bodyparser");
const { get, post } = require("koa-route");
const classifier = require("./classifier");
const github = require("./github");
const config = require("./config");

module.exports = function() {
  const app = new Koa();

  /* GET /status endpoint */
  app.use(
    get("/status", async ctx => {
      ctx.body = { message: "ticket-tagger lives!" };
      ctx.status = 200;
    })
  );

  app.use(body());

  /* POST /webhook endpoint */
  app.use(
    post("/webhook", async ctx => {
      /* payload integrity check */
      ctx.assert(
        github.verifySignature({
          payload: JSON.stringify(ctx.request.body),
          secret: config.githubSecret,
          signature: ctx.headers["x-hub-signature"]
        }),
        401,
        "invalid signature"
      );

      /* issue opened handler */
      if (ctx.request.body.action === "opened") {
        /* extract relevant issue metadata */
        const { title, labels, body, url } = ctx.request.body.issue;

        /* predict label */
        const [prediction, similarity] = await classifier.predict(
          `${title} ${body}`
        );

        if (similarity > 0) {
          /* extract installation id */
          const installationId = ctx.request.body.installation.id;

          /* get access token for repository */
          const accessToken = await github.getAccessToken({ installationId });

          /* update label */
          await github.setLabels({
            labels: [...labels, prediction],
            issue: url,
            accessToken
          });
        }
      }

      if (ctx.request.body.action === "created") {
        console.log(
          `${
            ctx.request.body.installation.account.login
          } installed ticket-tagger`
        );
      }

      ctx.status = 200;
    })
  );

  return app;
};
