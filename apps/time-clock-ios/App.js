import React from 'react';
import {View,Text,ActivityIndicator,StyleSheet,Linking,Platform,Pressable,AppState} from 'react-native';
import {StatusBar} from 'expo-status-bar';
import Constants from 'expo-constants';
import {WebView} from 'react-native-webview';

const url=Constants.expoConfig?.extra?.clockUrl;
const configured=typeof url==='string'&&url.startsWith('https://');
function allowedNavigation(target){
 try{
  const parsed=new URL(target);
  if(parsed.protocol!=='https:')return target==='about:blank';
  if(configured&&parsed.origin===url)return true;
  // Access-protected preview may redirect to the team and login hosts.
  if(parsed.hostname==='login.cloudflareaccess.com'||parsed.hostname.endsWith('.cloudflareaccess.com'))return true;
  return false;
 }catch{return target==='about:blank'}
}
export default function App(){
 const [error,setError]=React.useState('');
 const [loading,setLoading]=React.useState(true);
 const [reload,setReload]=React.useState(0);
 const [lastUrl,setLastUrl]=React.useState(url||'');
 const ref=React.useRef(null);
 const appState=React.useRef(AppState.currentState);
 const activeAgain=React.useCallback(()=>{
  // Keep the authenticated WebView and its cookies; refresh only page data.
  ref.current?.injectJavaScript("window.dispatchEvent(new Event('irm-clock-resume'));true;");
 },[]);
 React.useEffect(()=>{
  const subscription=AppState.addEventListener('change',next=>{
   const previous=appState.current;
   appState.current=next;
   if(previous.match(/inactive|background/)&&next==='active'&&configured&&!error)activeAgain();
  });
  return ()=>subscription.remove();
 },[activeAgain,error]);
 React.useEffect(()=>{
  if(!configured||!loading||error)return;
  const timer=setTimeout(()=>setError('The preview did not finish loading. Check the URL in Safari, Cloudflare deployment and Access login.'),25000);
  return ()=>clearTimeout(timer);
 },[loading,error,reload]);
 const retry=()=>{setError('');setLoading(true);setReload(x=>x+1)};
 return <View style={styles.screen}>
  <StatusBar style="light"/>
  <View style={styles.banner}><Text style={styles.bannerText}>IRM TIME CLOCK · PREVIEW / NON-PAYROLL</Text></View>
  {!configured?
   <View style={styles.center}>
    <Text style={styles.heading}>Preview URL not configured</Text>
    <Text style={styles.text}>Set EXPO_PUBLIC_CLOCK_URL to your deployed and protected HTTPS Time Clock URL for the EAS preview build, then rebuild or publish a compatible update.</Text>
   </View>:
  error?
   <View style={styles.center}>
    <Text style={styles.heading}>Unable to load Time Clock</Text>
    <Text style={styles.text}>{error}</Text>
    <Text style={styles.detail}>Configured origin: {url}</Text>
    <Text style={styles.detail}>Last loaded URL: {lastUrl}</Text>
    <Pressable style={styles.button} onPress={retry}><Text style={styles.buttonText}>Retry</Text></Pressable>
    <Pressable style={styles.outlineButton} onPress={()=>Linking.openURL(url).catch(()=>{})}><Text style={styles.outlineText}>Open preview in Safari</Text></Pressable>
    <Text style={styles.note}>No payroll punches are sent from this testing app.</Text>
   </View>:
   <View style={styles.webContainer}>
    {loading?<View style={styles.loading}><ActivityIndicator color="#0d9488"/><Text style={styles.detail}>Connecting to protected preview…</Text></View>:null}
    <WebView key={reload} ref={ref} source={{uri:url}} style={styles.webView}
     originWhitelist={['https://*']} javaScriptEnabled domStorageEnabled
     sharedCookiesEnabled thirdPartyCookiesEnabled={false}
     geolocationEnabled
     onLoadStart={({nativeEvent})=>{setLastUrl(nativeEvent.url||url);setLoading(true)}}
     onLoadEnd={()=>setLoading(false)}
     onNavigationStateChange={state=>setLastUrl(state.url||url)}
     onShouldStartLoadWithRequest={request=>{
       if(allowedNavigation(request.url))return true;
       // External navigation is handled in Safari rather than silently showing white.
       if(request.navigationType==='click'&&request.url.startsWith('https://'))Linking.openURL(request.url).catch(()=>{});
       return false;
     }}
     onError={({nativeEvent})=>setError(nativeEvent.description||'Network connection failed')}
     onHttpError={({nativeEvent})=>{
       const code=nativeEvent.statusCode;
       if(nativeEvent.url===url&&code>=400)setError('The preview server returned HTTP '+code+'.');
     }}
    />
   </View>}
 </View>;
}
const styles=StyleSheet.create({
 screen:{flex:1,backgroundColor:'#eef2f5',paddingTop:Platform.OS==='ios'?48:24},
 banner:{backgroundColor:'#10253c',padding:9,alignItems:'center'},
 bannerText:{color:'#ffffff',fontWeight:'700',fontSize:11,letterSpacing:0.5},
 webContainer:{flex:1},webView:{flex:1,backgroundColor:'#eef2f5'},
 loading:{position:'absolute',top:20,left:0,right:0,alignItems:'center',zIndex:1},
 center:{flex:1,alignItems:'center',justifyContent:'center',padding:24},
 heading:{fontWeight:'700',fontSize:22,color:'#10253c',marginBottom:12,textAlign:'center'},
 text:{fontSize:14,lineHeight:22,textAlign:'center',color:'#52677c',marginBottom:12},
 detail:{fontSize:12,color:'#6b7280',marginTop:8,textAlign:'center'},
 note:{fontSize:11,color:'#64748b',marginTop:22,textAlign:'center'},
 button:{backgroundColor:'#0d7573',paddingVertical:12,paddingHorizontal:32,borderRadius:9,marginTop:20},
 buttonText:{color:'#ffffff',fontWeight:'700'},
 outlineButton:{paddingVertical:12,paddingHorizontal:18,borderRadius:9,borderWidth:1,borderColor:'#0d7573',marginTop:10},
 outlineText:{color:'#0d7573',fontWeight:'700'}
});
