const {getDefaultConfig}=require('expo/metro-config');
const path=require('node:path');
const config=getDefaultConfig(__dirname);
// Shared source is outside this standalone app (the repository has no npm workspaces).
config.watchFolders=['packages','src'].map(folder=>path.resolve(__dirname,'../..',folder));
config.resolver.nodeModulesPaths=[path.resolve(__dirname,'node_modules')];
module.exports=config;
