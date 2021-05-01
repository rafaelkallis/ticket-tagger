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
 * @file mongoose encryption plugin
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const assert = require("assert");
const crypto = require("crypto");
const mongoose = require("mongoose");

/* https://tools.ietf.org/html/rfc3394#section-2.2.3.1 */
const A6_IV = Buffer.alloc(8, 0xa6);

// const encryptedFieldSchema = {
//   _ek: String,
//   _iv: String,
//   _ac: String,
//   _ct: String,
// };

function encryptionPlugin(schema, options = {}) {
  assert(options.key, "key is missing");
  const kekBytes = Buffer.from(options.key);
  const keyByteLength = kekBytes.length;
  assert(
    [16, 24, 32].includes(keyByteLength),
    "invalid key length, must be one of [16, 24, 32] bytes"
  );
  const keyBitLength = kekBytes.length * 8;

  const encryptedPaths = [];

  schema.eachPath(function (path, schemaType) {
    if (schemaType.schema) {
      schemaType.schema.plugin(encryptionPlugin, options);
      return;
    }

    if (!schemaType.options.encrypted) {
      return;
    }

    assert(
      schemaType instanceof mongoose.Schema.Types.String,
      "plugin can be used with String type only"
    );

    encryptedPaths.push({ path, schemaType });

    // schema.remove(path);
    // schema.add({ [path]: encryptedFieldSchema });
  });

  schema.method({
    encrypt() {
      for (const { path } of encryptedPaths) {
        const original = this.get(path);
        const originalBytes = Buffer.from(original);
        const ve = "1";
        const cekBytes = crypto.randomBytes(keyByteLength);
        const cekCipher = crypto.createCipheriv(
          `aes${keyBitLength}-wrap`,
          kekBytes,
          A6_IV
        );
        const ekBytes = Buffer.concat([
          cekCipher.update(cekBytes),
          cekCipher.final(),
        ]);
        const ek = ekBytes.toString("base64");
        /* aes is a 128-bit block algo, therefore iv is 128 bits */
        const ivBytes = crypto.randomBytes(16);
        const iv = ivBytes.toString("base64");
        const cipher = crypto.createCipheriv(
          `aes-${keyBitLength}-gcm`,
          cekBytes,
          ivBytes
        );
        const ct = Buffer.concat([
          cipher.update(originalBytes),
          cipher.final(),
        ]).toString("base64");
        const acBytes = cipher.getAuthTag();
        assert(acBytes.length === 16);
        const ac = acBytes.toString("base64");
        const metadata = [ve, ek, iv, ac, ct].join("$");
        this.set(path, metadata);
      }
    },
    decrypt() {
      for (const { path } of encryptedPaths) {
        const metadata = (this.get(path) || "").split("$");
        const [ve] = metadata;
        assert(ve, "no version found in metadata string");
        const plaintext = {
          0() {
            const [, ct] = metadata;
            return Buffer.from(ct, "base64").toString();
          },
          1() {
            const [, ek, iv, ac, ct] = metadata;
            const cekDecipher = crypto.createDecipheriv(
              `aes${keyBitLength}-wrap`,
              kekBytes,
              A6_IV
            );
            const ekBytes = Buffer.from(ek, "base64");
            const cekBytes = Buffer.concat([
              cekDecipher.update(ekBytes),
              cekDecipher.final(),
            ]);
            assert(cekBytes.length === keyByteLength);
            const ivBytes = Buffer.from(iv, "base64");
            assert(ivBytes.length === 16);
            const decipher = crypto.createDecipheriv(
              `aes-${keyBitLength}-gcm`,
              cekBytes,
              ivBytes
            );
            const acBytes = Buffer.from(ac, "base64");
            assert(acBytes.length === 16);
            decipher.setAuthTag(acBytes);
            const ctBytes = Buffer.from(ct, "base64");
            return Buffer.concat([
              decipher.update(ctBytes),
              decipher.final(),
            ]).toString();
          },
        }[ve]();
        if (!plaintext) {
          throw new Error("unsupported version");
        }
        this.set(path, plaintext);
      }
    },
  });

  schema.post("init", function postInitDecrypt(doc) {
    doc.decrypt();
  });

  schema.pre("save", function preSaveEncrypt() {
    this.encrypt();
  });
}

module.exports = { encryptionPlugin };
