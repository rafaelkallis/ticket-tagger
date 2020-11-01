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
 * @file config.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const envalid = require("envalid");

module.exports = envalid.cleanEnv(process.env, {
  NODE_ENV: envalid.str({ choices: ["production", "test", "development"] }),
  PORT: envalid.port({ devDefault: 3000 }),
  /* do not use the following GITHUB_SECRET in production! */
  GITHUB_SECRET: envalid.str({ devDefault: "123456" }),
  /* do not use the following GITHUB_CERT in production! */
  GITHUB_CERT: envalid.str({
    devDefault:
      "-----BEGIN RSA PRIVATE KEY-----\nMIIBOwIBAAJBAITFn4iFCecbUZbYluX+iD5kBQL5Zq+qv+0BliiZasE/3wsQ1WXt\nUWEJg415Awz36KZwC05/GgTPEMBv8RYS5y8CAwEAAQJACj65la42WmfoPsyNsEeY\nub+8B0O5Ybq6Po6NyKo1651l9dKSQhe31Xp7Cxdr79FUsYaW+itvYZVr7aFQHe+F\nsQIhAOVNimOdSn5NTLhyhxiK5DX8xRoOUvyfNjqtwNiVf9UJAiEAlDrxGlMKTStp\nvtNXNgZ+Lr8rCyGTQaRUKmh6QhoH4HcCIQDRX6EKXjgD5Y81KBYlGcVRanGK3iN2\nWeYJZFgfKzrjCQIgZZJuHEfCy1ZwQ562KAMS/B1q9Vmwek6MjfLBtAH6W8kCIQCE\nz5u3hfTPzDt+uUzolsZRKGiRmIwu8gPo66ljSG3cgQ==\n-----END RSA PRIVATE KEY-----",
  }),
  /* do not use the following GITHUB_APP_ID in production! */
  GITHUB_APP_ID: envalid.str({ devDefault: "123" }),
  FASTTEXT_MODEL_URI: envalid.str({
    default: "https://tickettagger.blob.core.windows.net/models/model.bin",
  }),
  APPINSIGHTS_INSTRUMENTATIONKEY: envalid.str({ devDefault: "" }),
});
