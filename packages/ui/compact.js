export const MOBILE_WORKSPACES=Object.freeze([{id:'scan',label:'Scan',description:'Fictional barcode scans'},{id:'warehouse',label:'Warehouse',description:'Orders and custody'},{id:'driver',label:'Driver',description:'Assignments and production'},{id:'account',label:'Account',description:'Sign-in and read-only inventory'}]);
export const isWideWorkspace=width=>width>=900;
export function workspaceVisibility(current,visited){return MOBILE_WORKSPACES.filter(w=>visited.includes(w.id)).map(w=>({...w,active:w.id===current}))}
