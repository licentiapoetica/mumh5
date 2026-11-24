package org.mumh5.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.IBinder;
import android.os.PowerManager;

// Keeps the process, the microphone and the network alive while the screen is off and voice is on.
public class VoiceService extends Service {
    private static final String CHANNEL = "voice";
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Voice", NotificationManager.IMPORTANCE_LOW));
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE);
        String text = intent != null && intent.getStringExtra("text") != null ? intent.getStringExtra("text") : "In voice";
        Notification n = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("mumh5")
            .setContentText(text)
            .setContentIntent(tap)
            .setOngoing(true)
            .build();
        startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        if (wake == null) {
            wake = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mumh5:voice");
            wake.acquire();
        }
        if (wifi == null) {
            wifi = getSystemService(WifiManager.class).createWifiLock(WifiManager.WIFI_MODE_FULL_LOW_LATENCY, "mumh5:voice");
            wifi.acquire();
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wake != null && wake.isHeld()) wake.release();
        if (wifi != null && wifi.isHeld()) wifi.release();
        wake = null;
        wifi = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
