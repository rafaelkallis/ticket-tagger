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
 * @file app.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

import { promisify } from "util";
import http from "http";
import express from "express";
import mongoose from "mongoose";
import { encryptionPlugin } from "./mongooseEncryptionPlugin";
import { Classifier } from "./Classifier";
import { GitHubAppClient } from "./Github";
import { WebApp } from "./WebApp";
import { WebhookApp } from "./WebhookApp";
import { Config } from "./Config";
import { Entities } from "./entities";

interface AppOptions {
  config: Config;
}

interface ServerConnection {
  end: () => void;
  destroy: () => void;
}

export function App({ config }: AppOptions) {
  const mongooseConnection = mongoose.createConnection(config.MONGO_URI);
  mongooseConnection.plugin(encryptionPlugin, {
    key: Buffer.from(config.MONGO_ENCRYPTION_KEY, "hex"),
  });
  const entities = Entities({ mongooseConnection });

  const appClient = new GitHubAppClient({ config, entities });
  const webApp = WebApp({ config, appClient, mongoConnection: mongooseConnection, entities });

  const classifier = Classifier.createFromRemote({
    config,
    modelUri: config.FASTTEXT_MODEL_URI,
  });
  const webhookApp = WebhookApp({ config, classifier, appClient });

  const app = express();

  app.enable("trust proxy");

  app.get("/status", (req, res) =>
    res.status(200).send({ message: "ticket-tagger lives!" })
  );

  app.use("/webhook", webhookApp.middleware);

  app.use(webApp);

  const server = http.createServer(app);

  const serverConnections = new Set<ServerConnection>();
  server.on("connection", (conn) => {
    serverConnections.add(conn);
    conn.on("close", () => {
      serverConnections.delete(conn);
    });
  });

  return { start, stop, server, webhookApp };

  async function start() {
    await mongooseConnection.asPromise();

    await classifier.initialize();

    await webhookApp.start();

    await promisify((cb: () => void) => server.listen(config.PORT, "0.0.0.0", cb))();

    console.info(`ticket-tagger listening on port ${config.PORT}`);
  }

  async function stop() {
    if (server.listening) {
      await promisify((cb: (err: Error | undefined) => void) => server.close(cb))();
      await promisify(setImmediate)();
      console.info("server stopped listening");
    }

    serverConnections.forEach((connection) => connection.end());
    await promisify(setImmediate)();
    serverConnections.forEach((connection) => connection.destroy());
    await promisify(setImmediate)();
    serverConnections.clear();
    console.info("connections closed");

    await webhookApp.stop();

    await mongoose.disconnect();
  }
}
