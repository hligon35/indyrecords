import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import {createOfflineWarehouseStore} from '../../../packages/warehouse/offline-store.js';
export const {loadWorkspace,cacheWorkspace,stageCommand,workflowRepository,syntheticWorkflowReceiver}=createOfflineWarehouseStore({openDatabase:SQLite.openDatabaseAsync,hashDigest:value=>Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,value)});
