package org.mumh5.voice
import android.annotation.SuppressLint
import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.*

class VoiceService : Service() {
 companion object { var instance: VoiceService? = null; const val CHANNEL = "voice" }
 private var wake: PowerManager.WakeLock? = null
 private var wifi: WifiManager.WifiLock? = null
 private var text = "In voice"
 private var muted = false
 private var deafened = false
 @SuppressLint("WakelockTimeout")
 override fun onStartCommand(intent: Intent?, flags: Int, id: Int): Int {
  val action = intent?.action
  if (action in listOf("mute", "deafen", "leave")) { VoicePlugin.instance?.action(action!!); return START_NOT_STICKY }
  instance = this; text = intent?.getStringExtra("text") ?: text
  getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "Voice", NotificationManager.IMPORTANCE_LOW))
  if (Build.VERSION.SDK_INT >= 29) startForeground(1, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) else startForeground(1, notification())
  if (wake == null) { wake = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mumh5:voice"); wake?.acquire() }
  if (wifi == null) { val mode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF; wifi = getSystemService(WifiManager::class.java).createWifiLock(mode, "mumh5:voice"); wifi?.acquire() }
  return START_NOT_STICKY
 }
 fun update(value: String, mute: Boolean, deaf: Boolean) { text = value; muted = mute; deafened = deaf; getSystemService(NotificationManager::class.java).notify(1, notification()) }
 private fun button(label: String, action: String, code: Int): Notification.Action {
  val pending = PendingIntent.getService(this, code, Intent(this, VoiceService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  return Notification.Action.Builder(null, label, pending).build()
 }
 private fun notification(): Notification {
  val open = packageManager.getLaunchIntentForPackage(packageName) ?: Intent()
  val pending = PendingIntent.getActivity(this, 0, open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  return Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_stat_voice).setContentTitle("mumh5").setContentText(text).setContentIntent(pending).setOngoing(true)
   .addAction(button(if (muted) "Unmute" else "Mute", "mute", 1)).addAction(button(if (deafened) "Undeafen" else "Deafen", "deafen", 2)).addAction(button("Leave", "leave", 3)).build()
 }
 override fun onDestroy() { if (instance === this) instance = null; if (wake?.isHeld == true) wake?.release(); if (wifi?.isHeld == true) wifi?.release(); wake = null; wifi = null; super.onDestroy() }
 override fun onBind(intent: Intent?): IBinder? = null
}
