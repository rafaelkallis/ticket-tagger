/**
 * @license AGPL-3.0
 * Ticket Tagger automatically predicts and labels issue types.
 * Copyright (C) 2018-2023  Rafael Kallis
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

import { Connection } from "mongoose";
import { Config } from "./Config";
import { Entities } from "./entities";
import path from "path";
import { callbackify, promisify } from "util";
import _ from "lodash";
import express from "express";
import  helmet from "helmet";
import { RateLimiterMemory } from "rate-limiter-flexible";
import session from "express-session";
import MongoSessionStore from "connect-mongo";
import { Passport } from "passport";
import { Strategy as GitHubStrategy } from "passport-github";
import nunjucks from "nunjucks";
import nunjucksOcticonsExtension from "nunjucks-octicons-extension";
import { GitHubAppClient, GitHubRepositoryClient, GitHubOAuthClient, repositoryConfigSchema } from "./Github";
import { UserState } from "./entities/User";

interface WebAppOptions {
  config: Config;
  appClient: GitHubAppClient;
  mongoConnection: Connection;
  entities: Entities;
}

declare global {
  namespace Express {
    interface Request {
      githubOAuthClient?: GitHubOAuthClient;
      githubRepositoryClient?: GitHubRepositoryClient;
      // session: express.Request["session"] & {
      //   returnTo?: string;
      // };
    }
    
    interface User extends UserState {}

    interface Locals {
      user?: UserState;
      installations?: Array<{ 
        id: number;
        account: {
          login: string;
        };
        suspended_at: string | null;
      }>;
      repositories?: Array<{}>;
      repository?: {
        url: string;
      };
    }
  }
}

declare module "express-session" {
  interface SessionData {
    returnTo?: string;
  }
}

export function WebApp({ config, appClient, mongoConnection, entities }: WebAppOptions) {
  const passport = new Passport();
  passport.use(
    new GitHubStrategy(
      {
        clientID: config.GITHUB_CLIENT_ID,
        clientSecret: config.GITHUB_CLIENT_SECRET,
        callbackURL: config.SERVER_BASE_URL + "/auth/callback",
        scope: ["user"],
        userAgent: config.USER_AGENT,
      },
      callbackify(async function verify(
        accessToken: string,
        _refreshToken: string /* refresh token is conciously ignored */,
        profile: GitHubStrategy.Profile
      ) {
        const _json = profile._json as { id: number };
        let user = await entities.User.findOne({ githubId: _json.id });
        user = user || new entities.User({ githubId: _json.id });
        user.accessToken = accessToken;
        await user.save();
        return user;
      })
    )
  );
  passport.serializeUser(callbackify((user: unknown) => {
    if (typeof user !== "object" || !user || !("id" in user)) {
      throw new Error("expected user");
    }
    return Promise.resolve(user.id)
  }));
  passport.deserializeUser(
    callbackify(async function deserializeUser(req: express.Request, id: string) {
      const user = await entities.User.findById(id);
      if (!user) {
        return false;
      }
      const githubOAuthClient = new GitHubOAuthClient({
        config,
        entities,
        accessToken: user.accessToken,
      });
      const checkTokenResponse = await githubOAuthClient.checkToken();
      if (!checkTokenResponse) {
        /* access token rejected, either expired or revoked by user */
        return false;
      }
      if (user.githubId !== checkTokenResponse.user.id) {
        return false;
      }
      req.githubOAuthClient = githubOAuthClient;
      return user;
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
  app.use(
    express.static(path.resolve(__dirname, "../dist"), { maxAge: "60s" })
  );

  const limiter = new RateLimiterMemory({
    points: config.RATELIMIT_WINDOW_POINTS,
    duration: config.RATELIMIT_WINDOW_SECONDS,
  });
  app.use(async function rateLimit(req, res, next) {
    res.set("RateLimit-Limit", String(config.RATELIMIT_WINDOW_POINTS));
    const [isSuccess, { remainingPoints, msBeforeNext }] = await limiter
      .consume(req.ip, 1)
      .then((res) => [true, res])
      .catch((res) => [false, res]);

    res.set("RateLimit-Remaining", String(remainingPoints));
    res.set("RateLimit-Reset", String(Math.floor(msBeforeNext / 1000)));
    if (isSuccess) {
      next();
    } else {
      res.status(429).render("429");
    }
  });

  app.use(
    session({
      name: config.SESSION_NAME,
      secret: config.SESSION_KEYS.split(","),
      saveUninitialized: false,
      resave: false,
      cookie: {
        secure: config.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 8 * 60 * 60 * 1000,
      },
      store: MongoSessionStore.create({
        clientPromise: new Promise((resolve) =>
          mongoConnection.once("open", () => resolve(mongoConnection.getClient()))
        ),
        /* https://github.com/jdesboeufs/connect-mongo#crypto-related-options */
        crypto: {
          secret: config.SESSION_STORE_ENCRYPTION_KEY,
        },
        autoRemove: "interval",
        autoRemoveInterval: 60,
      }),
    })
  );

  app.use(express.urlencoded({ extended: true }));

  app.use(passport.initialize());
  app.use(passport.session());

  app.use(function cachePrivate(req, res, next) {
    res.set("Cache-Control", "private, max-age=0, must-revalidate");
    next();
  });

  app.use(async function prepareApp(req, res, next) {
    const app = await appClient.getApp();
    Object.assign(res.locals, { app });
    next();
  });

  app.use(async function prepareUser(req, res, next) {
    if (req.isAuthenticated()) {
      res.locals.user = req.user;
    }
    next();
  });

  app.use(async function prepareInstallations(req, res, next) {
    if (req.isAuthenticated()) {
      if (!req.githubOAuthClient) {
        throw new Error("expected githubOAuthClient");
      }
      const { installations } = await req.githubOAuthClient.listInstallations();
      res.locals.installations = installations;
    }
    next();
  });

  app.get("/", function handleIndex(req, res) {
    if (!req.isAuthenticated()) {
      return res.render("index");
    }
    if (!res.locals) throw new Error("expected res.locals");
    const { installations } = res.locals;
    if (!installations) throw new Error("expected res.locals.installations");
    if (!installations.length) {
      return res.redirect("/install");
    }
    if (req.query.setup_action === "install") {
      const installation = installations.find(
        (i) => String(i.id) === req.query.installation_id
      );
      if (!installation) return res.redirect("/404");
      return res.redirect(`/${installation.account.login}?new=true`);
    }
    return res.redirect(`/${installations[0].account.login}`);
  });

  app.get("/404", (req, res) => res.render("404"));
  app.get("/429", (req, res) => res.render("429"));
  app.get("/access_denied", (req, res) => res.render("access_denied"));
  app.get("/privacy", (req, res) => res.render("privacy"));

  app.get("/login", passport.authenticate("github"));

  app.get(
    "/auth/callback",
    passport.authenticate("github", { failureRedirect: "/access_denied" }),
    async function handleAuthCallback(req, res) {
      if (!req.user) throw new Error("expected user");
      const githubOAuthClient = new GitHubOAuthClient({
        config,
        entities,
        accessToken: req.user.accessToken,
      });
      const { installations } = await githubOAuthClient.listInstallations();
      if (!installations.length) {
        return res.redirect("/install");
      }
      res.redirect(`/${installations[0].account.login}`);
    }
  );

  app.use(function ensureAuthenticated(req, res, next) {
    if (!req.isAuthenticated()) {
      req.session.returnTo = req.originalUrl;
      return res.redirect("/login");
    }
    next();
  });

  app.get("/install", function handleInstall(req, res) {
    res.render("install");
  });

  app.post("/logout", async function handleLogout(req, res) {
    await promisify(req.logout.bind(req))();
    res.redirect("/");
  });

  app.param("owner", async function prepareOwner(req, res, next, owner) {
    if (!req.isAuthenticated()) throw new Error("expected authenticated user");
    const { installations } = res.locals;
    if (!installations) throw new Error("expected res.locals.installations");
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
    // TODO implement
    // await appClient.unsuspendInstallation({ installation });
    res.redirect(`/${owner}`);
  });

  app.param("repo", async function prepareRepo(req, res, next, repo: string) {
    if (!req.isAuthenticated()) throw new Error("expected authenticated user");
    if (!req.githubOAuthClient) throw new Error("expected githubOAuthClient");
    const { owner } = res.locals;
    const repository = await req.githubOAuthClient.getRepository({
      owner,
      repo,
    });
    req.githubRepositoryClient = req.githubOAuthClient.createRepositoryClient({
      repositoryUrl: repository.url,
    });
    const config = await req.githubRepositoryClient.getConfig();
    Object.assign(res.locals, { repo, repository, config });
    return next();
  });

  app.post("/:owner/:repo", async function handleUpdateRepo(req, res) {
    let { form, sha, ...updatedRepositoryConfig } = req.body;
    /* lost update problem check */
    if (res.locals.config.exists && sha !== res.locals.config.sha) {
      return res.status(409).render("repo", { errors: { conflict: true } });
    }

    if (form === "general") {
      updatedRepositoryConfig.enabled = Boolean(
        updatedRepositoryConfig.enabled
      );
    }

    if (form === "threshold") {
      // not implemented
    }

    if (form === "labels") {
      for (const [key, value] of Object.entries<any>( // TODO remove any
        updatedRepositoryConfig.labels || []
      )) {
        updatedRepositoryConfig.labels[key] = {
          ...value,
          enabled: Boolean(value.enabled),
        };
      }
    }

    if (repositoryConfigSchema.validate(updatedRepositoryConfig).error) {
      return res.status(400).render("repo", { errors: { validation: true } });
    }
    /* here we authenticate with app instead of oauth in order to have ticket-tagger as committer */
    const installationClient = await appClient.createInstallationClient({
      installationId: res.locals.installation.id,
    });
    if (!installationClient.canWrite("single_file")) {
      return res.status(403).render("repo", { errors: { permissions: true } });
    }
    if (!res.locals.repository) throw new Error("expected res.locals.repository");
    const repositoryClient = installationClient.createRepositoryClient({
      repositoryUrl: res.locals.repository.url,
    });
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

  app.get("/:owner", async function handleListRepositories(req, res) {
    if (!req.githubOAuthClient) throw new Error("expected githubOAuthClient");
    const { repositories } =
      await req.githubOAuthClient.listRepositoriesByInstallationId({
        installationId: res.locals.installation.id,
      });
    res.locals.repositories = repositories;
    res.render("owner", _.pick(req.query, ["new"]));
  });

  app.get("/:owner/:repo", (req, res) =>
    res.render("repo", _.pick(req.query, ["updated"]))
  );

  return app;
}
