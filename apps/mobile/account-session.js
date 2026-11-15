import {warehouseStore} from './storage/warehouse-store.js';
import * as SecureStore from 'expo-secure-store';
import {createApiClient} from '../../packages/api-client/index.js';
import {createSessionController} from '../../packages/security/session-controller.js';
import {fieldStore} from './storage/field-store.js';
const api=s=>createApiClient({baseUrl:s.baseUrl,getAccessToken:()=>s.accessToken});
export const accountSession=createSessionController({
 storage:{getItem:SecureStore.getItemAsync,setItem:(key,value)=>SecureStore.setItemAsync(key,value,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY}),deleteItem:SecureStore.deleteItemAsync},
 verify:s=>api(s).getSession(),revoke:s=>api(s).endSession(),onLock:()=>{fieldStore.lockVerified();warehouseStore.lockVerified()}
});
