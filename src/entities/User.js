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
 * @file User
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  login: { type: String, required: true, index: { unique: true } },
  email: { type: String, required: true }, // TODO encrypt
  name: { type: String, required: true }, // TODO encrypt
  accessToken: { type: String }, // TODO encrypt
  loginAt: { type: Number, required: true },
  createdAt: { type: Number, required: true },
  updatedAt: { type: Number, required: true },
});

const User = mongoose.model("User", userSchema);

module.exports = { User };
