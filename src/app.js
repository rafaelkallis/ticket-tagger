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
 * @file app.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const Koa = require("koa");
const body = require("koa-bodyparser");
const { get, post } = require("koa-route");
const { Classifier } = require("./classifier");
const github = require("./github");
const config = require("./config");

module.exports = async function() {
  const classifier = await Classifier.ofRemoteUri(config.FASTTEXT_MODEL_URI);

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
          secret: config.GITHUB_SECRET,
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
