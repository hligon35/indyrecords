import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";
import { createOfflineFieldStore } from "../../../packages/field/offline-store.js";
const fieldStore = createOfflineFieldStore({ openDatabase: SQLite.openDatabaseAsync, hashDigest: (value) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value) });
export {
  fieldStore
};
