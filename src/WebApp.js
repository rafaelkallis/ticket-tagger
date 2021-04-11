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
const express = require("express");
const session = require("express-session");
const MongoSessionStore = require("connect-mongo");
const mongoose = require("mongoose");
const { Passport } = require("passport");
const { Strategy: GitHubStrategy } = require("passport-github");
const nunjucks = require("nunjucks");
const nunjucksOcticonsExtension = require("nunjucks-octicons-extension");
const { defaultsDeep } = require("lodash");
const YAML = require("yaml");
const { detailedDiff } = require("deep-object-diff");
const { GitHubOAuthClient, repositoryConfigDefaults } = require("./github");
const { repositoryConfigSchema } = require("./schemata");

function WebApp({ config, appClient }) {
  const passport = new Passport();

  passport.use(
    new GitHubStrategy(
      {
        clientID: config.GITHUB_CLIENT_ID,
        clientSecret: config.GITHUB_CLIENT_SECRET,
        callbackURL: config.SERVER_BASE_URL + "/auth/callback",
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

  // https://expressjs.com/en/starter/static-files.html
  app.use(express.static(path.resolve(__dirname, "../dist")));

  app.use(
    session({
      name: config.SESSION_NAME,
      secret: config.SESSION_KEYS,
      saveUninitialized: true,
      resave: false,
      cookie: {
        secure: config.isProduction,
        sameSite: "lax",
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

  app.use(
    asyncMiddleware(async function prepareInstallations(req, res, next) {
      if (!req.isAuthenticated()) return next();
      res.locals.user = req.user;
      res.locals.installations = await req.githubOAuthClient.listInstallations();
      next();
    })
  );

  app.get("/", (req, res) => {
    // redirect loop
    if (req.isAuthenticated()) return res.redirect(`/${req.user.login}`);
    res.render("index");
  });
  app.get("/login", passport.authenticate("github"));

  app.get("/auth/callback", passport.authenticate("github"), (req, res) => {
    res.redirect("/");
  });

  app.use(ensureAuthenticated({ config }));

  app.post("/logout", (req, res) => {
    req.logout();
    res.redirect("/");
  });

  app.param(
    "owner",
    asyncMiddleware(async function prepareOwner(req, res, next, owner) {
      if (!req.isAuthenticated()) return next();
      res.locals.owner = owner;
      const { installations } = res.locals;
      if (!installations.length) {
        req.logout();
        return res.redirect("/"); // beware of redirect loop
      }
      res.locals.installation = installations.find(
        (i) => i.account.login === owner
      );
      if (!res.locals.installation) {
        // render not found page
        return res.redirect(`/${installations[0].account.login}`);
      }
      next();
    })
  );

  app.param(
    "repo",
    asyncMiddleware(async function prepareRepo(req, res, next, repo) {
      if (!req.isAuthenticated()) return next();
      res.locals.repo = repo;
      const { owner } = res.locals;
      res.locals.repository = await req.githubOAuthClient.getRepository({
        owner,
        repo,
      });
      req.githubRepositoryClient = req.githubOAuthClient.createRepositoryClient(
        res.locals
      );
      res.locals.config = defaultsDeep(
        await req.githubRepositoryClient.getConfig(),
        repositoryConfigDefaults
      );
      next();
    })
  );

  app.get(
    "/:owner",
    asyncMiddleware(async function handleListRepositories(req, res) {
      res.locals.repositories = await req.githubOAuthClient.listRepositoriesByInstallationId(
        { installationId: res.locals.installation.id }
      );
      res.render("owner");
    })
  );

  app.get("/:owner/:repo", (req, res) => res.render("repo"));

  app.post(
    "/:owner/:repo",
    asyncMiddleware(async (req, res) => {
      req.body.labels = Object.fromEntries(
        Object.entries(req.body.labels || {}).map(([key, label]) => [
          key,
          { ...label, enabled: Boolean(label.enabled) },
        ])
      );
      if (repositoryConfigSchema.validate(req.body).error) {
        return res.sendStatus(400);
      }
      defaultsDeep(req.body, repositoryConfigDefaults);
      const { added, deleted, updated } = detailedDiff(
        res.locals.config,
        req.body
      );
      if ([added, deleted, updated].some((o) => !!Object.keys(o).length)) {
        /* change detected */
        const configYaml = await req.githubRepositoryClient.getConfigYaml();
        const configDoc = YAML.parseDocument(configYaml.content);

        traverse(added).forEach(([path, value]) =>
          configDoc.setIn(path, value)
        );
        traverse(deleted).forEach(([path, value]) =>
          configDoc.deleteIn(path, value)
        );
        traverse(updated).forEach(([path, value]) =>
          configDoc.setIn(path, value)
        );

        /* here we authenticate with app instead of oauth in order to have ticket-tagger as committer */
        const installationClient = await appClient.createInstallationClient(
          res.locals
        );
        if (!installationClient.canWrite("single_file")) {
          return res.sendStatus(403);
        }
        const repositoryClient = installationClient.createRepositoryClient(
          res.locals
        );
        await repositoryClient.setConfigYaml({
          content: configDoc.toString(),
          sha: configYaml.sha,
        });
        res.locals.config = defaultsDeep(
          configDoc.toJSON(),
          repositoryConfigDefaults
        );
      }

      res.render("repo");

      function traverse(value) {
        return Array.from(traverseInner([], value));
        function* traverseInner(path, value) {
          if (typeof value !== "object") {
            yield [path, value];
            return;
          }
          for (let [childKey, childValue] of Object.entries(value)) {
            yield* traverseInner([...path, childKey], childValue);
          }
        }
      }
    })
  );

  return app;
}

function asyncMiddleware(middleware) {
  return function innerAsyncMiddleware(req, res, next, ...args) {
    return Promise.resolve(middleware(req, res, next, ...args)).catch(next);
  };
}

function ensureAuthenticated() {
  return function ensureAuthenticatedInner(req, res, next) {
    if (!req.isAuthenticated()) {
      console.log("not authenticated!");
      req.session.returnTo = req.originalUrl;
      return res.redirect("/login");
    }
    return next();
  };
}

module.exports = { WebApp };
