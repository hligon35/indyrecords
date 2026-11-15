import {createOfflineWarehouseStore} from '../../../packages/warehouse/offline-store.js';
import {createMobileProtectedStore} from './field-store.js';
export const warehouseStore=createMobileProtectedStore({name:'warehouse',createStore:createOfflineWarehouseStore,legacyName:'irm-workflow-synthetic.db',demoActor:'local-demo-manager',roles:['warehouse','dispatcher','manager','admin'],validateState:(state,actor,tenant)=>state.records.every(r=>r.customerId===tenant)});
export const {loadWorkspace,cacheWorkspace,stageCommand,workflowRepository,syntheticWorkflowReceiver}=warehouseStore;
