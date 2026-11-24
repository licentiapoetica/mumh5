package org.mumh5.voice

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")])
class VoicePlugin(private val host: Activity) : Plugin(host) {
 companion object { var instance: VoicePlugin? = null }
 private var page: WebView? = null
 override fun load(webView: WebView) { page = webView; instance = this }
 @Command fun start(invoke: Invoke) {
  if (getPermissionState("microphone") != PermissionState.GRANTED) requestPermissionForAlias("microphone", invoke, "microphoneResult")
  else startVoice(invoke)
 }
 @PermissionCallback fun microphoneResult(invoke: Invoke) {
  if (getPermissionState("microphone") == PermissionState.GRANTED) startVoice(invoke) else invoke.reject("Microphone permission was not granted")
 }
 private fun startVoice(invoke: Invoke) {
  try {
   val intent = Intent(host, VoiceService::class.java).putExtra("text", invoke.getArgs().getString("text") ?: "In voice")
   host.startForegroundService(intent)
   keepVisible()
   val power = host.getSystemService(PowerManager::class.java)
   val exempt = power.isIgnoringBatteryOptimizations(host.packageName)
   val prefs = host.getSharedPreferences("voice", 0)
   if (!exempt && !prefs.getBoolean("askedBattery", false)) {
    prefs.edit().putBoolean("askedBattery", true).apply()
    try { host.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${host.packageName}"))) } catch (_: RuntimeException) { }
   }
   invoke.resolveObject(mapOf("batteryExempt" to exempt))
  } catch (e: RuntimeException) { invoke.reject(e.message ?: "Voice service failed") }
 }
 @Command fun stop(invoke: Invoke) { host.stopService(Intent(host, VoiceService::class.java)); invoke.resolve() }
 @Command fun update(invoke: Invoke) {
  VoiceService.instance?.update(invoke.getArgs().getString("text") ?: "In voice", invoke.getArgs().getBoolean("muted") ?: false, invoke.getArgs().getBoolean("deafened") ?: false)
  invoke.resolve()
 }
 fun action(action: String) { triggerObject("action", mapOf("action" to action)) }
 private fun keepVisible() {
  page?.post { if (VoiceService.instance != null) { page?.onResume(); page?.resumeTimers(); page?.dispatchWindowVisibilityChanged(View.VISIBLE) } }
 }
 override fun onPause(activity: AppCompatActivity) { keepVisible(); page?.postDelayed({ keepVisible() }, 150) }
 override fun onStop(activity: AppCompatActivity) { keepVisible(); page?.postDelayed({ keepVisible() }, 150) }
 override fun onResume(activity: AppCompatActivity) { keepVisible() }
}
