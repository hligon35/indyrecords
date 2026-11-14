import {requireOptionalNativeModule} from 'expo-modules-core';
import {normalizeScannerInput} from '../../packages/integrations/synthetic-scanner.js';
export function subscribeScanner(onBarcode){
 const native=requireOptionalNativeModule('IrmScanner');
 if(!native)return {available:false,remove(){}};
 let last='',lastAt=0;
 const listener=native.addListener('onScan',event=>{try{const value=normalizeScannerInput(event.barcode);const now=Date.now();if(last===value&&now-lastAt<750)return;last=value;lastAt=now;onBarcode(value)}catch{}});
 native.setEnabled(true);
 return {available:true,remove(){native.setEnabled(false);listener.remove()}};
}
