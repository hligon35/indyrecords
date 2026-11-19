import React from 'react';
import {View,Text,ActivityIndicator,StyleSheet,Linking,Platform} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import Constants from 'expo-constants';
import {WebView} from 'react-native-webview';
const url=Constants.expoConfig?.extra?.clockUrl;
export default function App(){
 const [error,setError]=React.useState(null);
 if(!url)return <View style={styles.screen}><Text style={styles.heading}>IRM Time Clock</Text><Text style={styles.text}>Preview URL not configured. Set EXPO_PUBLIC_CLOCK_URL to the protected HTTPS Cloudflare Time Clock origin before building.</Text></View>;
 return <View style={styles.screen}>
  <StatusBar style="light"/>
  <View style={styles.banner}><Text style={styles.bannerText}>IRM TIME CLOCK · PREVIEW / NON-PAYROLL</Text></View>
  {error?<View style={styles.center}><Text style={styles.heading}>Unable to open time clock</Text><Text style={styles.text}>{error}</Text></View>:
   <WebView source={{uri:url}} originWhitelist={[url]} javaScriptEnabled domStorageEnabled
    sharedCookiesEnabled thirdPartyCookiesEnabled={false}
    allowsBackForwardNavigationGestures
    geolocationEnabled
    onShouldStartLoadWithRequest={request=>{
      if(request.url.startsWith(url+'/')||request.url===url||request.url==='about:blank')return true;
      const allowed=request.url.startsWith('https://')&&request.url.includes('.cloudflareaccess.com/');
      if(allowed)return true;
      if(request.navigationType==='click'&&request.url.startsWith('https://'))Linking.openURL(request.url).catch(()=>{});
      return false;
    }}
    startInLoadingState renderLoading={()=><ActivityIndicator size="large" color="#0d9488" style={styles.center}/>}
    onError={event=>setError(event.nativeEvent.description||'Network error')}
    onHttpError={event=>{if(event.nativeEvent.statusCode>=500)setError('Preview server error ('+event.nativeEvent.statusCode+').')}}
   />}
 </View>;
}
const styles=StyleSheet.create({
 screen:{flex:1,backgroundColor:'#eef2f5',paddingTop:Platform.OS==='ios'?48:24},
 banner:{backgroundColor:'#10253c',padding:9,alignItems:'center'},
 bannerText:{color:'#ffffff',fontWeight:'700',fontSize:11,letterSpacing:0.5},
 center:{flex:1,alignItems:'center',justifyContent:'center',padding:24},
 heading:{fontWeight:'700',fontSize:22,color:'#10253c',marginBottom:12},
 text:{fontSize:14,lineHeight:22,textAlign:'center',color:'#52677c'}
});
