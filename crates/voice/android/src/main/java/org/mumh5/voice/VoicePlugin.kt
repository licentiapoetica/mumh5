package org.mumh5.voice

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.view.ViewTreeObserver
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@TauriPlugin(permissions = [
 Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone"),
 Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")
])
class VoicePlugin(private val host: Activity) : Plugin(host) {
 companion object { var instance: VoicePlugin? = null }
 private var page: WebView? = null
 // Chromium freezes a page 60 s after its window is hidden, which stops the audio worklet and
 // the Mumble pings. While voice runs, every hide the system reports is answered with "visible",
 // for as long as voice runs (the Capacitor shell did this by overriding the WebView).
 private val visibility = ViewTreeObserver.OnWindowVisibilityChangeListener { shown ->
  if (shown != View.VISIBLE && VoiceService.instance != null) keepVisible()
 }
 override fun load(webView: WebView) {
  page = webView; instance = this
  webView.viewTreeObserver.addOnWindowVisibilityChangeListener(visibility)
 }
 @Command fun start(invoke: Invoke) {
  if (getPermissionState("microphone") != PermissionState.GRANTED) requestPermissionForAlias("microphone", invoke, "microphoneResult")
  else startVoice(invoke)
 }
 @PermissionCallback fun microphoneResult(invoke: Invoke) {
  if (getPermissionState("microphone") == PermissionState.GRANTED) startVoice(invoke) else invoke.reject("Microphone permission was not granted")
 }
 // Android 13+: without it the Mute, Deafen and Leave notification stays hidden. Asked once,
 // after the microphone; voice runs either way.
 private fun askNotifications(invoke: Invoke): Boolean {
  if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) return false
  val prefs = host.getSharedPreferences("voice", 0)
  if (prefs.getBoolean("askedNotifications", false)) return false
  prefs.edit().putBoolean("askedNotifications", true).apply()
  requestPermissionForAlias("notifications", invoke, "notificationsResult")
  return true
 }
 @PermissionCallback fun notificationsResult(invoke: Invoke) { startVoice(invoke) }
 private fun startVoice(invoke: Invoke) {
  if (askNotifications(invoke)) return
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
