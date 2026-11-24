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
// Its notification has Mute and Deafen buttons; they come back here as intents and go to the page.
public class VoiceService extends Service {
    static final String ACTION_MUTE = "org.mumh5.app.MUTE";
    static final String ACTION_DEAFEN = "org.mumh5.app.DEAFEN";
    static final String ACTION_LEAVE = "org.mumh5.app.LEAVE";
    private static final String CHANNEL = "voice";
    static VoiceService instance;

    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;
    private String text = "In voice";
    private boolean muted = false;
    private boolean deafened = false;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_MUTE.equals(action) || ACTION_DEAFEN.equals(action) || ACTION_LEAVE.equals(action)) {
            // The page changes the state and sends it back, which redraws the buttons
            VoicePlugin.emitAction(ACTION_MUTE.equals(action) ? "mute" : ACTION_DEAFEN.equals(action) ? "deafen" : "leave");
            return START_NOT_STICKY;
        }
        instance = this;
        if (intent != null && intent.getStringExtra("text") != null) text = intent.getStringExtra("text");
        getSystemService(NotificationManager.class)
            .createNotificationChannel(new NotificationChannel(CHANNEL, "Voice", NotificationManager.IMPORTANCE_LOW));
        startForeground(1, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
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

    void update(String newText, boolean newMuted, boolean newDeafened) {
        text = newText;
        muted = newMuted;
        deafened = newDeafened;
        getSystemService(NotificationManager.class).notify(1, notification());
    }

    private Notification.Action button(String label, String action, int code) {
        Intent i = new Intent(this, VoiceService.class).setAction(action);
        PendingIntent p = PendingIntent.getService(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder(null, label, p).build();
    }

    private Notification notification() {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_voice)
            .setContentTitle("mumh5")
            .setContentText(text)
            .setContentIntent(tap)
            .setOngoing(true)
            .addAction(button(muted ? "Unmute" : "Mute", ACTION_MUTE, 1))
            .addAction(button(deafened ? "Undeafen" : "Deafen", ACTION_DEAFEN, 2))
            .addAction(button("Leave", ACTION_LEAVE, 3))
            .build();
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        if (wake != null && wake.isHeld()) wake.release();
        if (wifi != null && wifi.isHeld()) wifi.release();
        wake = null;
        wifi = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
