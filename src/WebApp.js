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
const express = require("express");
const session = require("express-session");
const MongoSessionStore = require("connect-mongo");
const mongoose = require("mongoose");
const { Passport } = require("passport");
const { Strategy: GitHubStrategy } = require("passport-github");
const nunjucks = require("nunjucks");
const { User } = require("./entities/User");
const { GitHubOAuthClient } = require("./github");

function WebApp({ config }) {
  const passport = new Passport();

  passport.use(
    new GitHubStrategy(
      {
        clientID: config.GITHUB_CLIENT_ID,
        clientSecret: config.GITHUB_CLIENT_SECRET,
        callbackURL: config.SERVER_BASE_URL + "/auth/callback",
      },
      (accessToken, refreshToken, profile, callback) => {
        return User.findOneAndUpdate(
          { login: profile.username },
          {
            login: profile.username,
            email: profile.emails.map(({ value }) => value)[0],
            name: profile.displayName,
            accessToken,
            loginAt: Date.now(),
          },
          { new: true, upsert: true },
          callback
        );
      }
    )
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => User.findById(id, done));

  const app = express();

  // https://mozilla.github.io/nunjucks/getting-started.html
  nunjucks.configure(path.resolve(__dirname, "../views"), {
    autoescape: true,
    express: app,
  });
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
        autoRemoveInterval: 10,
      }),
    })
  );

  app.use(express.urlencoded({ extended: false }));

  app.use(passport.initialize());
  app.use(passport.session());

  app.use(
    asyncMiddleware(async function prepareInstallations(req, res, next) {
      if (!req.isAuthenticated()) return next();
      const githubOAuthClient = new GitHubOAuthClient({
        config,
        accessToken: req.user.accessToken,
      });
      if (!(await githubOAuthClient.checkToken())) {
        console.log("revoked access token");
        // access token has been revoked
        req.logout();
        return next();
      }
      req.githubOAuthClient = githubOAuthClient;
      res.locals.user = await req.githubOAuthClient.getUser();
      res.locals.installations = await req.githubOAuthClient.listInstallations();
      next();
    })
  );

  app.get("/", (req, res) => {
    // redirect loop
    //if (req.isAuthenticated()) return res.redirect(`/${req.user.login}`);
    res.render("index");
  });
  app.get("/login", passport.authenticate("github"));

  app.get("/auth/callback", passport.authenticate("github"), (req, res) => {
    console.log("callback", JSON.stringify(req.user));
    res.redirect(`/${req.user.login}`);
  });

  app.use(ensureAuthenticated({ config }));

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
