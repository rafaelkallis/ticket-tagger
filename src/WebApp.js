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
 * @file web app
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const path = require("path");
const { callbackify } = require("util");
const _ = require("lodash");
const express = require("express");
const helmet = require("helmet");
const { RateLimiterMemory } = require("rate-limiter-flexible");
const session = require("express-session");
const MongoSessionStore = require("connect-mongo");
const mongoose = require("mongoose");
const { Passport } = require("passport");
const { Strategy: GitHubStrategy } = require("passport-github");
const nunjucks = require("nunjucks");
const nunjucksOcticonsExtension = require("nunjucks-octicons-extension");
const { GitHubOAuthClient, repositoryConfigSchema } = require("./github");

function WebApp({ config, appClient }) {
  const passport = new Passport();
  passport.use(
    new GitHubStrategy(
      {
        clientID: config.GITHUB_CLIENT_ID,
        clientSecret: config.GITHUB_CLIENT_SECRET,
        callbackURL: config.SERVER_BASE_URL + "/auth/callback",
        scope: ["user"],
        userAgent: config.USER_AGENT,
        passReqToCallback: true,
      },
      callbackify(async function verify(
        req,
        accessToken,
        _refreshToken,
        profile
      ) {
        /* make sure we are using a server-side session store, access token is sensitive */
        req.session.accessToken = accessToken;
        return profile._json;
      })
    )
  );
  passport.serializeUser(callbackify(async (user) => user.id));
  passport.deserializeUser(
    callbackify(async function deserializeUser(req, id) {
      const githubOAuthClient = new GitHubOAuthClient({
        config,
        accessToken: req.session.accessToken,
      });
      const checkTokenResponse = await githubOAuthClient.checkToken();
      if (!checkTokenResponse) {
        throw new Error("revoked access token");
      }
      if (id !== checkTokenResponse.user.id) {
        throw new Error("unexpected user id mismatch");
      }
      req.githubOAuthClient = githubOAuthClient;
      return checkTokenResponse.user;
    })
  );

  const app = express();

  // https://mozilla.github.io/nunjucks/getting-started.html
  const nunjucksEnv = nunjucks.configure(path.resolve(__dirname, "../views"), {
    autoescape: true,
    express: app,
  });
  nunjucksEnv.addExtension("Octicon", nunjucksOcticonsExtension);

  app.set("view engine", "njk");

  /* security https://helmetjs.github.io/ */
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          "img-src": ["'self'", "avatars.githubusercontent.com"],
        },
      },
    })
  );

  // https://expressjs.com/en/starter/static-files.html
  app.use(express.static(path.resolve(__dirname, "../dist")));

  const limiter = new RateLimiterMemory({
    points: config.RATELIMIT_WINDOW_POINTS,
    duration: config.RATELIMIT_WINDOW_SECONDS,
  });
  app.use(async function rateLimit(req, res, next) {
    res.setHeader("RateLimit-Limit", String(config.RATELIMIT_WINDOW_POINTS));
    const [isSuccess, { remainingPoints, msBeforeNext }] = await limiter
      .consume(req.ip, 1)
      .then((res) => [true, res])
      .catch((res) => [false, res]);

    res.setHeader("RateLimit-Remaining", String(remainingPoints));
    res.setHeader("RateLimit-Reset", String(Math.floor(msBeforeNext / 1000)));
    if (isSuccess) {
      next();
    } else {
      res.status(429).render("429");
    }
  });

  app.use(
    session({
      name: config.SESSION_NAME,
      secret: config.SESSION_KEYS,
      saveUninitialized: true,
      resave: false,
      cookie: {
        secure: config.isProduction,
        sameSite: "strict",
      },
      store: MongoSessionStore.create({
        clientPromise: new Promise((resolve) =>
          mongoose.connection.once("open", () =>
            resolve(mongoose.connection.client)
          )
        ),
        /* https://github.com/jdesboeufs/connect-mongo#crypto-related-options */
        crypto: { secret: config.SESSION_STORE_ENCRYPTION_KEY },
        autoRemove: "interval",
        autoRemoveInterval: 60,
      }),
    })
  );

  app.use(express.urlencoded({ extended: true }));

  app.use(passport.initialize());
  app.use(passport.session());

  app.use(async function prepareApp(req, res, next) {
    const app = await appClient.getApp();
    Object.assign(res.locals, { app });
    return next();
  });

  app.use(async function prepareInstallations(req, res, next) {
    if (req.isAuthenticated()) {
      Object.assign(res.locals, {
        user: req.user,
        installations: await req.githubOAuthClient.listInstallations(),
      });
    }
    return next();
  });

  app.get("/", (req, res) => {
    if (!req.isAuthenticated()) return res.render("index");
    if (req.query.setup_action === "install") {
      const installation = res.locals.installations.find(
        (i) => String(i.id) === req.query.installation_id
      );
      if (!installation) return res.redirect("/404");
      return res.redirect(`/${installation.account.login}?new=true`);
    }
    res.redirect(`/${req.user.login}`);
  });

  app.get("/login", passport.authenticate("github"));

  app.get("/auth/callback", passport.authenticate("github"), (req, res) => {
    res.redirect("/");
  });

  app.use(function ensureAuthenticated(req, res, next) {
    if (!req.isAuthenticated()) {
      req.session.returnTo = req.originalUrl;
      return res.redirect("/login");
    }
    return next();
  });

  app.get("/install", (req, res) => res.render("install"));
  app.get("/404", (req, res) => res.render("404"));
  app.get("/429", (req, res) => res.render("429"));

  app.post("/logout", (req, res) => {
    req.logout();
    res.redirect("/");
  });

  app.param("owner", async function prepareOwner(req, res, next, owner) {
    if (!req.isAuthenticated()) throw new Error("expected authenticated user");
    const { installations } = res.locals;
    if (!installations.length) {
      return res.redirect("/install");
    }
    const installation = installations.find((i) => i.account.login === owner);
    if (!installation) {
      return res.redirect(`/${installations[0].account.login}`);
    }
    Object.assign(res.locals, {
      owner,
      installation,
      suspended: Boolean(installation.suspended_at),
    });
    return next();
  });

  app.post("/:owner/unsuspend", async function handleUnsuspend(req, res) {
    const { owner, installation } = res.locals;
    await appClient.unsuspendInstallation({ installation });
    res.redirect(`/${owner}`);
  });

  app.param("repo", async function prepareRepo(req, res, next, repo) {
    if (!req.isAuthenticated()) throw new Error("expected authenticated user");
    const { owner } = res.locals;
    const repository = await req.githubOAuthClient.getRepository({
      owner,
      repo,
    });
    req.githubRepositoryClient = req.githubOAuthClient.createRepositoryClient({
      repository,
    });
    const config = await req.githubRepositoryClient.getConfig();
    Object.assign(res.locals, { repo, repository, config });
    return next();
  });

  app.post("/:owner/:repo", async function handleUpdateRepo(req, res) {
    let { sha, ...updatedRepositoryConfig } = req.body;
    /* lost update problem check */
    if (res.locals.config.exists && sha !== res.locals.config.sha) {
      return res.status(409).render("repo", { errors: { conflict: true } });
    }
    /* form booleans */
    if (updatedRepositoryConfig.enabled !== undefined) {
      updatedRepositoryConfig.enabled = Boolean(
        updatedRepositoryConfig.enabled
      );
    }
    if (updatedRepositoryConfig.labels !== undefined) {
      updatedRepositoryConfig.labels = Object.fromEntries(
        Object.entries(
          updatedRepositoryConfig.labels || {}
        ).map(([key, label]) => [
          key,
          { ...label, enabled: Boolean(label.enabled) },
        ])
      );
    }
    if (repositoryConfigSchema.validate(updatedRepositoryConfig).error) {
      return res.status(400).render("repo", { errors: { validation: true } });
    }
    /* here we authenticate with app instead of oauth in order to have ticket-tagger as committer */
    const installationClient = await appClient.createInstallationClient(
      res.locals
    );
    if (!installationClient.canWrite("single_file")) {
      return res.status(403).render("repo", { errors: { permissions: true } });
    }
    const repositoryClient = installationClient.createRepositoryClient(
      res.locals
    );
    /* create config if it does not exist */
    if (!res.locals.config.exists) {
      res.locals.config = await repositoryClient.createConfig();
      sha = res.locals.config.sha;
    }
    /* merge changes */
    res.locals.config = await repositoryClient.mergeConfig({
      repositoryConfig: res.locals.config.json,
      repositoryConfigYaml: res.locals.config.yaml,
      sha,
      updatedRepositoryConfig,
    });

    res.redirect(`/${res.locals.owner}/${res.locals.repo}`);
  });

  app.use(function cacheHeaders(req, res, next) {
    res.set("Cache-Control", "max-age=0, private, must-revalidate");
    return next();
  });

  app.get("/:owner", async function handleListRepositories(req, res) {
    res.locals.repositories = await req.githubOAuthClient.listRepositoriesByInstallationId(
      { installationId: res.locals.installation.id }
    );
    res.render("owner", _.pick(req.query, ["new"]));
  });

  app.get("/:owner/:repo", (req, res) =>
    res.render("repo", _.pick(req.query, ["updated"]))
  );

  return app;
}

module.exports = { WebApp };
