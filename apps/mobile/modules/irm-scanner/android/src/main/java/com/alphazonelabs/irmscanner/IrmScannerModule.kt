package com.alphazonelabs.irmscanner

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class IrmScannerModule : Module() {
  private var registered = false
  private var enabled = false
  private val action = "com.alphazonelabs.irmrmsdemo.SCAN"
  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (!enabled || intent?.action != action || appContext.currentActivity?.hasWindowFocus() != true) return
      val value = intent.getStringExtra("com.symbol.datawedge.data_string") ?: return
      if (value.length !in 1..100) return
      sendEvent("onScan", mapOf("barcode" to value, "source" to "datawedge-intent"))
    }
  }

  override fun definition() = ModuleDefinition {
    Name("IrmScanner")
    Events("onScan")
    Function("setEnabled") { value: Boolean -> enabled = value }
    OnStartObserving {
      val context = appContext.reactContext ?: return@OnStartObserving
      if (!registered) {
        val filter = IntentFilter(action).apply { addCategory(Intent.CATEGORY_DEFAULT) }
        // DataWedge is a separate app. All received input remains untrusted and
        // is checked against the synthetic inventory/workflow before persistence.
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        else { @Suppress("DEPRECATION") context.registerReceiver(receiver, filter) }
        registered = true
      }
    }
    OnStopObserving { unregister() }
    OnDestroy { unregister() }
  }

  private fun unregister() {
    if (registered) {
      try { appContext.reactContext?.unregisterReceiver(receiver) } catch (_: IllegalArgumentException) { }
      registered = false
    }
    enabled = false
  }
}
